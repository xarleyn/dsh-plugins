#:property PublishAot=false
using System.Text;
using System.Text.Json;

// Read-only. Print counts and lengths, never chat IDs, paths, arguments or result text.
if (args.Length != 1 || !Directory.Exists(args[0]))
{
    Console.Error.WriteLine("Usage: dotnet run --file benchmark-frequency.cs -- EXPORTED_JSONL_DIRECTORY");
    return 2;
}
var enumeration = new EnumerationOptions
{
    RecurseSubdirectories = true, IgnoreInaccessible = false, AttributesToSkip = FileAttributes.ReparsePoint
};
var files = Directory.EnumerateFiles(args[0], "session.v*.jsonl", enumeration)
    .Where(path => Path.GetFileName(path) is "session.v3.jsonl" or "session.v4.jsonl")
    .OrderByDescending(Path.GetFileName, StringComparer.Ordinal).ThenBy(path => path, StringComparer.Ordinal);
var seen = new HashSet<string>();
var sizes = new List<int>();
int artifacts = 0, roots = 0, children = 0, duplicates = 0, incomplete = 0, unmatched = 0, results = 0;
foreach (var path in files)
{
    artifacts++;
    using var reader = File.OpenText(path);
    try
    {
        using var header = JsonDocument.Parse(reader.ReadLine() ?? "");
        var h = header.RootElement;
        if (Text(h, "type") != "session" || Text(h, "id") is not string id) throw new InvalidDataException();
        if (seen.Contains(id)) { duplicates++; continue; }
        if (Text(h, "origin") == "subagent" || Flag(h, "isSeeded") ||
            (h.TryGetProperty("delegationDepth", out var depth) && depth.GetInt32() > 0))
        { children++; continue; }
        var tools = new Dictionary<string, string>();
        var localSizes = new List<int>();
        int localResults = 0, localUnmatched = 0;
        while (reader.ReadLine() is string line)
        {
            using var record = JsonDocument.Parse(line);
            var e = record.RootElement;
            var type = Text(e, "type");
            if (type is not ("tool/result" or "tool/call")) continue;
            var data = e.GetProperty("data");
            if (type == "tool/call")
            {
                tools[data.GetProperty("callId").GetString()!] = data.GetProperty("name").GetString()!;
                continue;
            }
            var message = data.GetProperty("message");
            localResults++;
            // V3 records a single tool-result block inside a user-role message.
            if (Text(message, "role") == "user")
            {
                var content = message.GetProperty("content");
                if (content.ValueKind != JsonValueKind.Array || content.GetArrayLength() != 1 ||
                    Text(content[0], "type") != "tool-result") throw new InvalidDataException();
                message = content[0];
            }
            if (!tools.TryGetValue(Text(message, "toolCallId") ?? "", out var tool)) { localUnmatched++; continue; }
            if (tool is not ("read" or "grep" or "search" or "web_fetch") || Flag(message, "isError")) continue;
            var blocks = message.GetProperty("content");
            if (blocks.ValueKind != JsonValueKind.Array || blocks.GetArrayLength() == 0) continue;
            int bytes = 0;
            bool textual = true;
            foreach (var block in blocks.EnumerateArray())
            {
                if (Text(block, "type") != "text" || Text(block, "text") is not string text) { textual = false; break; }
                bytes += Encoding.UTF8.GetByteCount(text);
            }
            if (textual) localSizes.Add(bytes + 2 * (blocks.GetArrayLength() - 1));
        }
        seen.Add(id);
        sizes.AddRange(localSizes);
        roots++;
        results += localResults;
        unmatched += localUnmatched;
    }
    catch (Exception ex) when (ex is JsonException or InvalidDataException or InvalidOperationException or KeyNotFoundException)
    { incomplete++; }
}
sizes.Sort();
int? Quantile(double fraction) => sizes.Count == 0 ? null : sizes[(int)Math.Ceiling(sizes.Count * fraction) - 1];
Console.WriteLine(JsonSerializer.Serialize(new { artifacts, roots, children, duplicates, incomplete, results, unmatched,
    eligibleText = sizes.Count, above300000 = sizes.Count(n => n > 300_000), atLeast24000 = sizes.Count(n => n >= 24_000),
    p50 = Quantile(0.50), p95 = Quantile(0.95), p99 = Quantile(0.99), max = Quantile(1) }));
return roots > 0 ? 0 : 1;

static string? Text(JsonElement obj, string name) =>
    obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
static bool Flag(JsonElement obj, string name) => obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.True;
