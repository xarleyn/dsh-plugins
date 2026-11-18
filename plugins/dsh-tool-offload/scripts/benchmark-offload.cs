#:property PublishAot=false
using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var seed = 17;
var chunkBytes = 64_000;
var chunksOnly = args.LastOrDefault() == "--chunks-only";
if (chunksOnly) args = args[..^1];
if (args.Length is < 2 or > 5 ||
    !Uri.TryCreate(args[0], UriKind.Absolute, out var endpoint) || !endpoint.IsLoopback || endpoint.Scheme != "http" ||
    (args.Length >= 3 && !int.TryParse(args[2], CultureInfo.InvariantCulture, out seed)) ||
    (args.Length >= 4 && args[3] is not ("all" or "source" or "search" or "log")) ||
    (args.Length == 5 && (!int.TryParse(args[4], CultureInfo.InvariantCulture, out chunkBytes) || chunkBytes is < 16_000 or > 64_000)))
{
    Console.Error.WriteLine("Usage: dotnet run --file benchmark-offload.cs -- http://127.0.0.1:PORT MODEL [seed] [all|source|search|log] [chunkBytes: 16000..64000] [--chunks-only]");
    return 2;
}
string[] kinds = args.Length >= 4 && args[3] != "all" ? [args[3]] : ["source", "search", "log"];
var model = args[1];
const string task = "Collect each CONFIRMED release evidence record. Return one line per record with its exact path:line citation and exact quoted text, keeping them paired. Ignore draft and routine records. If there are none, say NONE.";
using var client = new HttpClient { BaseAddress = endpoint, Timeout = TimeSpan.FromMinutes(4) };
using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
using var warmup = await Chat("Return OK.", 8, stop.Token);
foreach (var kind in kinds)
{
    foreach (var target in chunksOnly ? new[] { 312_000 } : new[] { 32_000, 312_000 })
    {
        var (original, facts) = Corpus(kind, target, seed);
        var tool = kind switch
        {
            "source" => "read",
            "search" => "grep",
            _ => "read_log"
        };
        var originalBytes = Encoding.UTF8.GetByteCount(original);
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(original))).ToLowerInvariant();
        var prepared = await Contract(new { operation = "prepare", tool, task, text = original });
        var route = prepared.GetProperty("route");
        var pass = route.GetProperty("kind").GetString() == "passthrough";
        if (pass != (target > 300_000) || (pass && route.GetProperty("reason").GetString() != "payload-too-large"))
            throw new InvalidDataException($"Unexpected production route: {route}");
        var calls = new List<Call>();
        var rawTokens = await TokenCount(original);
        var routeMs = prepared.GetProperty("routeMs").GetDouble();
        if (!pass)
        {
            var answer = await Extract(prepared, originalBytes, "single", calls, stop.Token);
            await Report("current-single", answer, calls, routeMs);
            continue;
        }
        if (!chunksOnly) await Report("current-pass", original, calls, routeMs);
        var extracts = new List<string>();
        var chunks = Chunks(original, chunkBytes).ToArray();
        if (string.Concat(chunks) != original) throw new InvalidDataException("Chunk round trip failed.");
        // A generous experimental deadline measures the complete chain. The report also compares it with 45 s.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
        deadline.CancelAfter(TimeSpan.FromMinutes(15));
        foreach (var chunk in chunks)
        {
            var input = await Contract(new { operation = "prepare", tool, task, text = chunk });
            var answer = await Extract(input, Encoding.UTF8.GetByteCount(chunk), "map", calls, deadline.Token);
            extracts.Add(answer);
        }
        var joined = string.Join("\n\n", extracts);
        await Validate(joined, originalBytes);
        await Report("maps", joined, calls, routeMs);
        var reducer = await Contract(new { operation = "reduce", tool, task, text = joined });
        var reduced = await Extract(reducer, originalBytes, "reduce", calls, deadline.Token);
        await Report("map-reduce", reduced, calls, routeMs);

        async Task Report(string path, string parent, List<Call> requests, double routingMs)
        {
            int parentTokens = parent == original ? rawTokens : await TokenCount(parent);
            var missing = Missing(parent, facts);
            var parentBytes = Encoding.UTF8.GetByteCount(parent);
            var inputTokens = requests.Sum(c => c.Input);
            var outputTokens = requests.Sum(c => c.Output);
            var parentPrompt = $"{task}\n\n<RESULT>\n{parent}\n</RESULT>";
            var timer = Stopwatch.StartNew();
            using var reply = await Chat(parentPrompt, 512, stop.Token);
            timer.Stop();
            var choice = reply.RootElement.GetProperty("choices")[0];
            if (choice.GetProperty("finish_reason").GetString() != "stop") throw new InvalidDataException("Incomplete parent generation.");
            var answer = choice.GetProperty("message").GetProperty("content").GetString()!;
            var answerMissing = Missing(answer, facts);
            var usage = reply.RootElement.GetProperty("usage");
            var parentInput = usage.GetProperty("prompt_tokens").GetInt32();
            var parentOutput = usage.GetProperty("completion_tokens").GetInt32();
            if (parentInput < parentTokens - 1) throw new InvalidDataException("Parent input was truncated.");
            // Illustrative USD per million tokens (parent input/output 1/4, worker 0.20/0.80).
            var scenarioUsd = (parentInput + parentOutput * 4m + inputTokens * 0.20m + outputTokens * 0.80m) / 1_000_000m;
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                kind, seed, target, chunkBytes, digest, model, path, originalBytes, rawTokens,
                parentBytes, parentTokens, inputTokens, outputTokens, workerMs = requests.Sum(c => c.Ms),
                routingMs, parentMs = timer.ElapsedMilliseconds, parentInput, parentOutput, scenarioUsd,
                retained = facts.Length - missing.Length, answerRetained = facts.Length - answerMissing.Length,
                total = facts.Length, missing, answerMissing, requests, answer, parentSummary = parent == original ? null : parent
            }));
        }
    }
}
return 0;

static Fact[] Missing(string output, Fact[] facts)
{
    var lines = output.Split('\n');
    return facts.Where(fact => !lines.Any(line => line.Contains(fact.Quote, StringComparison.Ordinal)
        && Regex.IsMatch(line, Regex.Escape(fact.Citation) + @"(?!\d)"))).ToArray();
}

async Task<int> TokenCount(string text)
{
    using var response = await client.PostAsJsonAsync("/tokenize", new { content = text, add_special = false }, stop.Token);
    response.EnsureSuccessStatusCode();
    using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(stop.Token));
    return body.RootElement.GetProperty("tokens").GetArrayLength();
}

async Task<JsonDocument> Chat(string prompt, int maxTokens, CancellationToken token)
{
    using var response = await client.PostAsJsonAsync("/v1/chat/completions", new {
        model, messages = new[] { new { role = "user", content = prompt } }, temperature = 0,
        seed, max_tokens = maxTokens, stream = false, cache_prompt = false,
        chat_template_kwargs = new { enable_thinking = false }
    }, token);
    response.EnsureSuccessStatusCode();
    return JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
}

async Task<string> Extract(JsonElement prepared, int bytes, string phase, List<Call> calls, CancellationToken token)
{
    var clock = Stopwatch.StartNew();
    using var body = await Chat(prepared.GetProperty("prompt").GetString()!, 512, token);
    clock.Stop();
    var choice = body.RootElement.GetProperty("choices")[0];
    if (choice.GetProperty("finish_reason").GetString() != "stop") throw new InvalidDataException("Incomplete generation.");
    var answer = choice.GetProperty("message").GetProperty("content").GetString()!;
    var usage = body.RootElement.GetProperty("usage");
    calls.Add(new(phase, usage.GetProperty("prompt_tokens").GetInt32(), usage.GetProperty("completion_tokens").GetInt32(), clock.ElapsedMilliseconds));
    await Validate(answer, bytes);
    Console.Error.WriteLine($"{phase}: {calls[^1]}");
    return answer;
}

async Task Validate(string text, int bytes)
{
    var result = await Contract(new { operation = "validate", text, bytes });
    if (!result.GetProperty("ok").GetBoolean()) throw new InvalidDataException($"Rejected worker output: {result}");
}

async Task<JsonElement> Contract(object request, [CallerFilePath] string source = "")
{
    var info = new ProcessStartInfo("node")
    {
        RedirectStandardInput = true, RedirectStandardOutput = true, UseShellExecute = false,
        StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8
    };
    info.ArgumentList.Add(Path.Combine(Path.GetDirectoryName(source)!, "benchmark-contract.mjs"));
    using var process = Process.Start(info)!;
    var output = process.StandardOutput.ReadToEndAsync(stop.Token);
    await process.StandardInput.WriteAsync(JsonSerializer.Serialize(request));
    process.StandardInput.Close();
    await process.WaitForExitAsync(stop.Token);
    if (process.ExitCode != 0) throw new InvalidOperationException("Build the plugin before running the benchmark.");
    using var json = JsonDocument.Parse(await output);
    return json.RootElement.Clone();
}

static IEnumerable<string> Chunks(string text, int limit)
{
    var part = new StringBuilder();
    var bytes = 0;
    foreach (Match row in Regex.Matches(text, @"[^\n]*\n|[^\n]+$"))
    {
        var length = Encoding.UTF8.GetByteCount(row.Value);
        if (length > limit) throw new InvalidDataException("A fixture row exceeds the chunk limit.");
        if (bytes + length > limit)
        {
            yield return part.ToString();
            part.Clear();
            bytes = 0;
        }
        part.Append(row.Value);
        bytes += length;
    }
    if (bytes != 0) yield return part.ToString();
}

static (string, Fact[]) Corpus(string kind, int target, int seed)
{
    var lines = new List<string>();
    var random = new Random(seed);
    string[] topics = ["lilac", "cobalt", "amber", "maple", "linden", "azure", "teal", "silver"];
    for (int bytes = 0; bytes < target;)
    {
        var name = topics[random.Next(topics.Length)];
        var n = lines.Count + 1;
        var row = kind switch {
            "source" => $"src/{name}.ts:{n} export const draft{n} = {{ status: 'DRAFT', label: 'review pending for the next release' }};\n",
            "search" => $"docs/{name}.md:{n}: DRAFT match: validation remains pending until the next ordinary review cycle.\n",
            _ => $"logs/{name}.log:{n} INFO routine check finished; observed healthy worker; no approved release evidence.\n"
        };
        lines.Add(row);
        bytes += Encoding.UTF8.GetByteCount(row);
    }
    var facts = new List<Fact>();
    foreach (var position in new[] { 0.01, 0.19, 0.39, 0.57, 0.79, 0.99 })
    {
        int index = (int)(position * lines.Count);
        var citation = lines[index].Split(' ')[0].TrimEnd(':');
        var name = topics[random.Next(topics.Length)];
        string quote = kind switch {
            "source" => $"export const {name}Limit = {random.Next(1000, 9000)};",
            "search" => $"{name} release window spans {random.Next(15, 95)} minutes",
            _ => $"{name} queue drained after {random.Next(300, 900)} retries"
        };
        facts.Add(new(citation, quote));
        lines[index] = $"{citation} CONFIRMED \"{quote}\"\n";
    }
    return (string.Concat(lines), facts.ToArray());
}

record Fact(string Citation, string Quote);
record Call(string Phase, int Input, int Output, long Ms);
