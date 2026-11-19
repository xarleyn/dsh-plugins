#!/usr/bin/env -S dotnet --
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

const int outputLimit = 384;
const int seed = 17;
const int retrievalLimit = 2;
const decimal dollarsPerMillionInput = 1;
const decimal dollarsPerMillionOutput = 4;
const string indexedSource = "benchmark-index.md";
const string fullSource = "benchmark-catalog.md";
const string retention = "Временные отчёты хранятся 17 суток.";
const string approval = "Код утверждения временных отчётов: orchid-6.";
const string tariff = "Цена и валюта внешнего экспорта в утверждённом каталоге отсутствуют.";
const string instruction = " Проверь разрешённые источники: индекс и файл benchmark-catalog.md в рабочей папке. Назови использованные источники. Если сведений нет, укажи, каких именно. У меня нет дополнительных фактов. Ответь по-русски, до четырёх предложений.";

if (args is not [var dshBin, var root, var workspaceId, var harness])
    throw new ArgumentException("Use smoke:packed --compare-answer-modes to provision the disposable profile.");

var rootPath = Path.GetFullPath(root);
var workspace = Path.Combine(rootPath, "workspace");
var home = Path.Combine(rootPath, "home");
if (Path.GetFullPath(Environment.GetEnvironmentVariable("DSH_HOME") ?? ".") != home ||
    !Path.GetRelativePath(Path.Combine(rootPath, "tool"), dshBin).StartsWith("node_modules" + Path.DirectorySeparatorChar, StringComparison.Ordinal))
    throw new ArgumentException("The Harness and profile must come from the same disposable smoke run.");

var endpoint = new Uri(RequiredEnvironment("DSH_QA_BENCH_ENDPOINT"));
if (!endpoint.IsLoopback || endpoint.Scheme != "http" || endpoint.UserInfo.Length > 0 || endpoint.AbsolutePath != "/" ||
    endpoint.Query.Length > 0 || endpoint.Fragment.Length > 0)
    throw new ArgumentException("Specify a loopback HTTP inference origin without credentials or a path.");
var model = RequiredEnvironment("DSH_QA_BENCH_MODEL");
var output = Path.GetFullPath(RequiredEnvironment("DSH_QA_BENCH_RESULTS"));
var requestedSkip = Environment.GetEnvironmentVariable("DSH_QA_BENCH_SKIP");
var skip = requestedSkip is null ? 0 : int.Parse(requestedSkip, CultureInfo.InvariantCulture);
var requestedLimit = Environment.GetEnvironmentVariable("DSH_QA_BENCH_LIMIT");
var limit = requestedLimit is null ? 18 - skip : int.Parse(requestedLimit, CultureInfo.InvariantCulture);
if (limit is < 1 or > 18 || skip is < 0 or > 17 || limit > 18 - skip)
    throw new ArgumentException("Keep the requested slice within the 18 trials.");
const string questionTool = "ask_user_question";
string[] primaryTools = ["read", "grep", "glob", "dsh_lightrag_query"];
string[] ragTools = ["dsh_lightrag_query"];
string[] reviewerTools = ["read", "structured_output"];

Question[] questions =
[
    new("known", "Какой срок хранения временных отчётов?" + instruction, retention, retention),
    new("partial", "Какой срок хранения и какой код утверждения временных отчётов?" + instruction, retention, $"{retention} {approval}"),
    new("absent", "Какова цена внешнего экспорта временных отчётов и в какой валюте?" + instruction, "", tariff),
];
Mode[] modes =
[
    new("fast", ["fast"]),
    new("deep", ["deep"]),
    new("rag-decline", ["deep", "rag"], Consent: false),
    new("default-reviewed", []),
    new("rag-allow", ["deep", "rag"], Consent: true),
    new("deep-fast", ["fast", "deep"]),
];
var cases = questions.SelectMany((question, index) =>
    modes.Skip(index * 2).Concat(modes.Take(index * 2)).Select(mode => new Trial(question, mode))).Skip(skip).Take(limit);

using var upstream = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
{
    BaseAddress = endpoint,
    Timeout = TimeSpan.FromMinutes(3),
};
var modelInventory = await upstream.GetFromJsonAsync<JsonNode>("/v1/models");
if (modelInventory?["data"]?.AsArray().Any(node => String(node, "id") == model) != true)
    throw new InvalidOperationException("The requested model is not served by the local endpoint.");

// Preload the model's template and decoding path outside the timed cases.
using (var warmup = await upstream.PostAsJsonAsync("/v1/chat/completions", new
{
    model,
    messages = new[] { new { role = "user", content = "Say OK." } },
    temperature = 0,
    max_tokens = 8,
    chat_template_kwargs = new { enable_thinking = false },
}))
    warmup.EnsureSuccessStatusCode();

await using var writer = new StreamWriter(new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
var settings = new JsonSerializerOptions(JsonSerializerDefaults.Web);
await writer.WriteLineAsync(JsonSerializer.Serialize(new
{
    type = "setup", harness, model, seed, outputLimit, retrievalLimit, skip, limit, dollarsPerMillionInput, dollarsPerMillionOutput,
    indexedSource, fullSource, fullCorpus = new[] { retention, approval, tariff },
}, settings));

Trial? active = null;
var builder = WebApplication.CreateSlimBuilder([]);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
await using var app = builder.Build();
app.MapPost("/query", async context =>
{
    var trial = Volatile.Read(ref active) ?? throw new InvalidOperationException("No active trial.");
    var query = await JsonNode.ParseAsync(context.Request.Body);
    trial.Retrieval.Enqueue(new { mode = String(query, "mode"), query = String(query, "query") });
    var evidence = trial.Question.Indexed;
    var references = evidence.Length == 0 ? Array.Empty<object>() :
        [new { reference_id = "1", file_path = indexedSource, content = new[] { evidence } }];
    await context.Response.WriteAsJsonAsync(new { response = evidence, llm_generated = evidence.Length > 0, references });
});
app.MapPost("/v1/chat/completions", async context =>
{
    var trial = Volatile.Read(ref active) ?? throw new InvalidOperationException("No active trial.");
    var request = await JsonNode.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted) ??
        throw new InvalidDataException("The Harness sent an empty model request.");
    var route = String(request, "model");
    var call = new ModelCall(route);
    trial.Calls.Enqueue(call);
    var clock = Stopwatch.StartNew();
    try
    {
        request["model"] = model;
        request["temperature"] = 0;
        request["seed"] = seed;
        request["max_tokens"] = outputLimit;
        request.AsObject().Remove("max_completion_tokens");
        request["cache_prompt"] = false;
        request["chat_template_kwargs"] = new JsonObject { ["enable_thinking"] = false };
        // The disposable profile has only the two benchmark sources. Keep the
        // advertised catalogue aligned with what its role grants can execute.
        if (request["tools"] is JsonArray tools)
        {
            var awaitingExpansion = trial.Mode.Consent.HasValue && !trial.DeepSearchApproved;
            var allowed = route == "reviewer" ? reviewerTools : awaitingExpansion ? ragTools : primaryTools;
            var canAskConsent = route == "primary" && awaitingExpansion && !trial.ConsentAnswered;
            var canQueryIndex = trial.Retrieval.Count < retrievalLimit;
            request["tools"] = new JsonArray(tools
                .Where(tool =>
                {
                    var name = String(tool?["function"], "name");
                    if (name == "dsh_lightrag_query" && !canQueryIndex) return false;
                    return allowed.Contains(name, StringComparer.Ordinal) || (canAskConsent && name == questionTool);
                })
                .Select(tool => tool!.DeepClone()).ToArray());
        }
        if (request["stream"]?.GetValue<bool>() == true)
            request["stream_options"] = new JsonObject { ["include_usage"] = true };
        using var forwarded = new HttpRequestMessage(HttpMethod.Post, "/v1/chat/completions") { Content = JsonContent.Create(request) };
        using var reply = await upstream.SendAsync(forwarded, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
        call.HttpStatus = (int)reply.StatusCode;
        context.Response.StatusCode = call.HttpStatus;
        context.Response.ContentType = reply.Content.Headers.ContentType?.ToString();
        using var reader = new StreamReader(await reply.Content.ReadAsStreamAsync(context.RequestAborted));
        if (reply.Content.Headers.ContentType?.MediaType == "text/event-stream")
        {
            while (await reader.ReadLineAsync(context.RequestAborted) is { } line)
            {
                if (line.StartsWith("data: {", StringComparison.Ordinal))
                    call.Observe(JsonNode.Parse(line[6..]));
                await context.Response.WriteAsync(line + "\n", context.RequestAborted);
                if (line.Length == 0) await context.Response.Body.FlushAsync(context.RequestAborted);
            }
        }
        else
        {
            var body = await reader.ReadToEndAsync(context.RequestAborted);
            if (reply.IsSuccessStatusCode) call.Observe(JsonNode.Parse(body));
            else Console.Error.WriteLine($"Inference HTTP {call.HttpStatus}: {body}");
            await context.Response.WriteAsync(body, context.RequestAborted);
        }
    }
    finally
    {
        call.ElapsedMilliseconds = clock.ElapsedMilliseconds;
    }
});
await app.StartAsync();

var port = FreePort();
var origin = $"http://127.0.0.1:{port}";
var patch = Path.Combine(rootPath, "comparison.patch.yml");
await File.WriteAllTextAsync(patch, Patch(workspaceId, app.Urls.Single()));
var start = new ProcessStartInfo("node")
{
    WorkingDirectory = workspace, UseShellExecute = false, CreateNoWindow = true,
    RedirectStandardOutput = true, RedirectStandardError = true,
};
foreach (var arg in new[] { dshBin, "web", "--patch", patch, "--no-open", "--port", port.ToString(CultureInfo.InvariantCulture) })
    start.ArgumentList.Add(arg);
foreach (var key in start.Environment.Keys.Where(name => name.EndsWith("_API_KEY", StringComparison.OrdinalIgnoreCase)).ToArray())
    start.Environment.Remove(key);
start.Environment["QA_BENCH_PLACEHOLDER"] = "synthetic-benchmark";
using var host = new Process { StartInfo = start, EnableRaisingEvents = true };
var ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
var logs = new ConcurrentQueue<string>();
void ObserveHost(object sender, DataReceivedEventArgs evt)
{
    if (evt.Data is not { } line) return;
    var match = Regex.Match(line, Regex.Escape(origin) + @"/\?token=\S+");
    if (match.Success) ready.TrySetResult(match.Value);
    logs.Enqueue(Regex.Replace(line, @"([?&]token=)[^\s&#]+", "$1[redacted]"));
    while (logs.Count > 40) logs.TryDequeue(out _);
}
host.OutputDataReceived += ObserveHost;
host.ErrorDataReceived += ObserveHost;
host.Exited += (_, _) => ready.TrySetException(new InvalidOperationException("The disposable Harness exited before startup."));
if (!host.Start()) throw new InvalidOperationException("The disposable Harness did not start.");
host.BeginOutputReadLine();
host.BeginErrorReadLine();
try
{
    var launch = await ready.Task.WaitAsync(TimeSpan.FromSeconds(60));
    using var qa = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
    {
        BaseAddress = new Uri(origin),
        Timeout = TimeSpan.FromSeconds(25),
    };
    using (var login = await qa.GetAsync(launch))
        if (login.StatusCode != HttpStatusCode.SeeOther)
            throw new InvalidOperationException("Could not authenticate the local Harness.");

    Task<JsonNode> Remote(string name, object args) => Rpc(qa, origin, "qaSurface/" + name, args);
    var admin = await Remote("accountsRegister", new { email = "benchmark-admin@example.test", password = "synthetic-benchmark-admin" });
    var user = await Remote("accountsRegister", new { email = "benchmark-user@example.test", password = "synthetic-benchmark-user" });
    var adminToken = String(admin, "token");
    var token = String(user, "token");
    if (String(admin["user"], "role") != "admin" || String(user["user"], "role") != "user")
        throw new InvalidOperationException("The fresh profile did not create the expected roles.");

    var snapshot = await Remote("accessAdminSnapshot", new { token = adminToken });
    var general = snapshot["config"]!["subroles"]!.AsArray().Single(node => String(node, "id") == "general")!.DeepClone();
    general["capabilities"]!["tools"]!["always"] = new JsonArray(primaryTools.Append(questionTool).Select(name => JsonValue.Create(name)).ToArray());
    general["capabilities"]!["tools"]!["deny"] = new JsonArray("docs_search", "code_sources");
    await Remote("accessUpdateSubrole", new { token = adminToken, id = "general", input = general });
    var userId = Guid.Parse(String(user["user"], "id"));
    var userDirectory = Path.Combine(workspace, ".qa-users", userId.ToString());
    Directory.CreateDirectory(userDirectory);
    await File.WriteAllLinesAsync(Path.Combine(userDirectory, fullSource), [retention, approval, tariff]);

    foreach (var trial in cases)
    {
        var selected = trial.Mode;
        var prompt = trial.Question.Prompt;
        using (var health = await upstream.GetAsync("/v1/models"))
            health.EnsureSuccessStatusCode();
        // A new session each time keeps history and previous retrieval out of the comparison.
        var created = await Remote("createSession", new { token, subroleId = (string?)null, adminPreview = false });
        var sessionId = created.GetValue<string>();
        var requestId = Guid.NewGuid().ToString();
        var fast = selected.Values.Contains("fast", StringComparer.Ordinal);
        Volatile.Write(ref active, trial);
        var clock = Stopwatch.StartNew();
        if (fast)
        {
            var result = await Remote("slashExecute", new
            {
                token, sessionId, line = "/no-review " + prompt, attachments = Array.Empty<object>(), modes = selected.Values,
            });
            if (String(result, "kind") != "executed" || String(result["outcome"], "kind") != "success")
                throw new InvalidOperationException("The Fast command did not run: " + result.ToJsonString());
        }
        else
        {
            if (selected.Values.Length > 0)
                await Remote("prepareAnswerModes", new { token, sessionId, requestId, modes = selected.Values });
            await Remote("chatPrompt", new
            {
                token, request = new { sessionId, requestId, mode = "queue", content = new[] { new { type = "text", text = prompt } } },
            });
        }
        var consentAt = new List<long>();
        var skippedQuestions = new List<string>();
        var runningSeen = false;
        long? cancelledAt = null;
        do
        {
            var pending = await Remote("pendingQuestions", new { token, sessionId });
            foreach (var question in pending.AsArray())
            {
                var answers = question!["questions"]!.AsArray().Select(item =>
                {
                    var id = String(item, "id");
                    if (id == "qa-rag-deep-search" && selected.Consent.HasValue)
                    {
                        trial.ConsentAnswered = true;
                        trial.DeepSearchApproved = selected.Consent == true;
                        consentAt.Add(clock.ElapsedMilliseconds);
                        var label = selected.Consent == true ? "Да, провести глубокий поиск" : "Нет, ответить по найденному";
                        return new { id, selected = new[] { label } };
                    }
                    skippedQuestions.Add(id);
                    return new { id, selected = Array.Empty<string>() };
                }).ToArray();
                await Remote("answerQuestion", new
                {
                    token, sessionId, requestId = String(question, "id"),
                    answers,
                });
            }
            var chats = await Remote("chatList", new { token });
            var running = chats["items"]!.AsArray().FirstOrDefault(item => String(item, "sessionId") == sessionId)?["running"]?.GetValue<bool>();
            runningSeen |= running == true;
            if (running == false && (runningSeen || trial.Calls.Any(call => call.ElapsedMilliseconds.HasValue))) break;
            if (cancelledAt is null && clock.Elapsed > TimeSpan.FromMinutes(5))
            {
                cancelledAt = clock.ElapsedMilliseconds;
                await Remote("chatCancel", new { token, sessionId });
            }
            if (clock.Elapsed > TimeSpan.FromMinutes(5.5))
                throw new TimeoutException($"The trial did not settle after cancellation: {trial.Question.Id}/{selected.Id}.");
            await Task.Delay(200);
        } while (true);
        var elapsedMilliseconds = cancelledAt ?? clock.ElapsedMilliseconds;
        var history = await Remote("chatPage", new { token, request = new { address = new { kind = "session", sessionId }, maxMessages = 100 } });
        var events = history["records"]!.AsArray().Select(record => record!["event"]!).ToArray();
        var receipts = events.Where(evt => String(evt["data"]?["source"], "kind").StartsWith("answer-review", StringComparison.Ordinal))
            .Select(evt => evt["data"]!["source"]).ToArray();
        var assistant = events.Where(evt => String(evt, "type") == "assistant/message")
            .Select(evt => evt["data"]!["message"]!).Select(MessageText).Where(text => text.Length > 0).ToArray();
        var tools = events.Where(evt => String(evt, "type") is "tool/call" or "tool/result")
            .Select(evt => new { type = String(evt, "type"), data = evt["data"] }).ToArray();
        var calls = trial.Calls.Select(call => call.ToResult()).ToArray();
        if (cancelledAt is null && !calls.Any(call => call.HttpStatus is >= 200 and < 300))
            throw new InvalidOperationException($"No model response for {trial.Question.Id}/{selected.Id}.");
        var completeUsage = calls.Length > 0 && calls.All(call => call.Input.HasValue && call.Output.HasValue);
        var input = calls.Sum(call => call.Input ?? 0);
        var generated = calls.Sum(call => call.Output ?? 0);
        var price = (input * dollarsPerMillionInput + generated * dollarsPerMillionOutput) / 1_000_000;
        await writer.WriteLineAsync(JsonSerializer.Serialize(new
        {
            type = "trial", question = trial.Question.Id, prompt, expected = trial.Question.Expected,
            mode = selected.Id, selected = selected.Values, selected.Consent, consentAt, skippedQuestions, elapsedMilliseconds,
            timedOut = cancelledAt.HasValue,
            completeUsage, input, output = generated, scenarioUsd = completeUsage ? price : (decimal?)null,
            answer = assistant.LastOrDefault() ?? "", assistant, receipts, tools, retrieval = trial.Retrieval.ToArray(), calls,
        }, settings));
        Console.WriteLine($"{trial.Question.Id}/{selected.Id}: {elapsedMilliseconds} ms, {calls.Length} calls, {input}/{generated} tokens, consent {consentAt.Count}");
        Volatile.Write(ref active, null);
    }
}
catch
{
    foreach (var line in logs) Console.Error.WriteLine(line);
    throw;
}
finally
{
    if (!host.HasExited)
    {
        host.Kill(entireProcessTree: true);
        await host.WaitForExitAsync();
    }
    await app.StopAsync();
}
return 0;

static string RequiredEnvironment(string name) =>
    Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : throw new ArgumentException($"Set {name}.");

static string String(JsonNode? source, string name) => source?[name]?.GetValue<string>() ?? "";

static string MessageText(JsonNode message) => string.Join("\n", (message["content"]?.AsArray() ?? [])
    .Where(item => String(item, "type") == "text").Select(item => String(item, "text")));

static int FreePort()
{
    using var socket = new TcpListener(IPAddress.Loopback, 0);
    socket.Start();
    return ((IPEndPoint)socket.LocalEndpoint).Port;
}

static async Task<JsonNode> Rpc(HttpClient qa, string origin, string method, object args)
{
    using var request = new HttpRequestMessage(HttpMethod.Post, "/api/" + method)
    {
        Content = JsonContent.Create(new { type = "client-request", rpcId = Guid.NewGuid(), method, payload = new { args } }),
    };
    request.Headers.Add("Origin", origin);
    using var reply = await qa.SendAsync(request);
    var result = (await reply.Content.ReadFromJsonAsync<JsonNode>())?["result"];
    if (!reply.IsSuccessStatusCode || result?["ok"]?.GetValue<bool>() != true)
        throw new InvalidOperationException($"{method} failed (HTTP {(int)reply.StatusCode}): {result?["error"]}");
    // Some mutating RPCs return no value.
    return result["value"] ?? new JsonObject();
}

static string Patch(string workspaceId, string endpoint) => $$"""
- insert:
    - id: preset-qa-benchmark-review
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: qa-benchmark-review
        plugins:
          - id: search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
- id: dsh-qa-surface
  config:
    accounts:
      enabled: true
      allowRegistration: true
      perUserWorkspace: true
    session:
      workspaceId: {{JsonSerializer.Serialize(workspaceId)}}
      agentPreset: standard
      provider: qa-benchmark
      model: primary
    interaction:
      questions: interactive
    slashCommands:
      commands:
        mode: allow-list
        allow: [no-review]
    tools:
      dynamicActivation: false
      activationPresets: []
    lockdown:
      sandboxMode: workspace-write
      permissionPreset: qa-benchmark-workspace
      allowSlashCommands: true
- id: permission
  config:
    defaultPreset: qa-benchmark-workspace
    presets:
      qa-benchmark-workspace:
        sandbox: workspace-write
        approval: never
- id: llm-pi-ai
  config:
    providers:
      qa-benchmark:
        displayName: QA benchmark
        api: openai-completions
        apiKeyEnv: QA_BENCH_PLACEHOLDER
        baseURL: {{endpoint}}/v1
        models:
          - id: primary
            name: Benchmark primary
          - id: reviewer
            name: Benchmark reviewer
- id: dsh-lightrag
  config:
    endpoint: {{endpoint}}
- id: dsh-answer-review-gate
  config:
    failMode: warn
    minCandidateChars: 1
    maxReviewRounds: 2
    reviewer:
      backend: subagent
      provider: spawn
      route: qa-benchmark
      model: reviewer
      agentPreset: qa-benchmark-review
      enforceAllowedTools: true
      allowedTools: [read]
      persona: >-
        Evaluate the candidate against the question and the evidence in the review packet.
        benchmark-index.md is an index reference, not a file in the workspace.
        If you need independent confirmation from the local catalogue, read benchmark-catalog.md once in the current workspace.
        Do not list directories or search for another copy of either source.
        Respect the primary agent's evidence and consent limits when assessing a stated gap.
        Finish with the required structured_output tool as soon as you have assessed the claims.
      roundTimeoutMs: 90000
""";

sealed record Question(string Id, string Prompt, string Indexed, string Expected);
sealed record Mode(string Id, string[] Values, bool? Consent = null);
sealed record Trial(Question Question, Mode Mode)
{
    public volatile bool ConsentAnswered;
    public volatile bool DeepSearchApproved;
    public ConcurrentQueue<ModelCall> Calls { get; } = new();
    public ConcurrentQueue<object> Retrieval { get; } = new();
}

sealed record CallResult(string Route, int HttpStatus, int? Input, int? Output, long? ElapsedMilliseconds, string Text, string Finish, ToolCall[] Tools);
sealed record ToolCall(string Name, string Arguments);

sealed class ModelCall(string route)
{
    private readonly StringBuilder text = new();
    private readonly Dictionary<int, ToolCall> tools = new();
    private int? input;
    private int? output;
    private string finish = "";
    public int HttpStatus { get; set; }
    public long? ElapsedMilliseconds { get; set; }

    public void Observe(JsonNode? value)
    {
        if (value?["usage"] is { } usage)
        {
            input = usage["prompt_tokens"]?.GetValue<int>();
            output = usage["completion_tokens"]?.GetValue<int>();
        }
        foreach (var choice in value?["choices"]?.AsArray() ?? [])
        {
            finish = choice?["finish_reason"]?.GetValue<string>() ?? finish;
            var message = choice?["delta"] ?? choice?["message"];
            text.Append(message?["content"]?.GetValue<string>());
            var toolIndex = 0;
            foreach (var call in message?["tool_calls"]?.AsArray() ?? [])
            {
                var key = call?["index"]?.GetValue<int>() ?? toolIndex;
                var function = call?["function"];
                tools.TryGetValue(key, out var previous);
                tools[key] = new ToolCall(
                    (previous?.Name ?? "") + function?["name"]?.GetValue<string>(),
                    (previous?.Arguments ?? "") + function?["arguments"]?.GetValue<string>());
                toolIndex++;
            }
        }
    }

    public CallResult ToResult() => new(route, HttpStatus, input, output, ElapsedMilliseconds, text.ToString(), finish, tools.OrderBy(pair => pair.Key).Select(pair => pair.Value).ToArray());
}
