#:property TargetFramework=net10.0

using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

return AttachmentInventory.Run(args);

sealed class AttachmentInventory(string home, int minimumAgeDays)
{
    private const string Usage = "Usage: dotnet run --file scripts/qa-attachments-dry-run.cs -- --offline --home <absolute DSH_HOME> [--min-age-days <0..36500>]";
    private static readonly Regex Digest = new(@"(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly JsonDocumentOptions StrictJson = new() { AllowDuplicateProperties = false };
    private static readonly HashSet<string> SessionHeaderFields =
        ["type", "version", "id", "createdAt", "cwd", "parentSession", "isSeeded", "origin", "delegationDepth", "agentPreset"];

    private readonly ProfileView view = new(home);
    private readonly Dictionary<string, SortedSet<string>> references = new(StringComparer.Ordinal);
    private readonly HashSet<string> sessionIds = new(StringComparer.Ordinal);
    private readonly SortedDictionary<string, StoredFile> files = new(StringComparer.Ordinal);
    private readonly List<Blocker> blockers = [];
    private readonly DateTimeOffset scannedAt = DateTimeOffset.UtcNow;
    private int sessions;
    private int seededSessions;
    private int formRows;
    private int mutationRows;
    private int resourceRows;

    public static int Run(string[] args)
    {
        if (args is ["--help"])
        {
            Console.WriteLine(Usage);
            return 0;
        }

        if (args is not (["--offline", "--home", _] or ["--offline", "--home", _, "--min-age-days", _]) ||
            !Path.IsPathFullyQualified(args[2]))
        {
            Console.Error.WriteLine(Usage);
            return 2;
        }

        int days = 7;
        if (args.Length == 5 &&
            (!int.TryParse(args[4], NumberStyles.None, CultureInfo.InvariantCulture, out days) || days > 36500))
        {
            Console.Error.WriteLine(Usage);
            return 2;
        }

        string home = Path.TrimEndingDirectorySeparator(Path.GetFullPath(args[2]));
        if (Path.GetPathRoot(home) == home)
        {
            Console.Error.WriteLine(Usage);
            return 2;
        }

        return new AttachmentInventory(home, days).Scan();
    }

    private int Scan()
    {
        var kept = new List<ObjectReport>();
        var candidates = new List<ObjectReport>();
        Check("profile", home, view.CheckHome);
        if (blockers.Count == 0)
        {
            Check("sessions", At("sessions"), ScanSessions);
            Check("form-storage", At("qa-forms.db"), ScanForms);
            Check("provenance", At("qa-sources"), ScanProvenance);
            Check("session-purge", At(".qa-session-purges"), CheckPurgeJournal);
            Check("file-storage", At("attachments"), ReadStore);
            if (blockers.Count == 0)
                Check("file-identity", At("attachments", "v1"), () => Classify(kept, candidates));
            Check("profile-stability", home, view.Verify);
        }

        if (blockers.Count != 0) candidates.Clear();
        var report = new ScanReport(
            1, "dry-run", scannedAt, minimumAgeDays, blockers.Count == 0, blockers,
            new Counts(sessions, seededSessions, formRows, mutationRows, resourceRows, files.Count),
            candidates.Sum(item => item.Bytes),
            candidates,
            kept);
        Console.WriteLine(JsonSerializer.Serialize(report, InventoryJson.Default.ScanReport));
        return blockers.Count == 0 ? 0 : 3;
    }

    private void ScanSessions()
    {
        foreach (string project in view.Children(At("sessions")))
        foreach (string directory in view.Children(project))
        {
            Check("session-journal", directory, () =>
            {
                string[] contents = view.Children(directory);
                Require(contents.Length == 1, "Expected exactly one session generation and no staging files.");
                string path = contents[0];
                string name = Path.GetFileName(path);
                Require(name is "session.v4.jsonl" or "session.v4.jsonl.zstd", "Unsupported session generation.");
                view.File(path);
                using var file = System.IO.File.OpenRead(path);
                using var lines = (name.EndsWith(".zstd", StringComparison.Ordinal) ? CompressedLines(file) : JsonLines(file)).GetEnumerator();
                Require(lines.MoveNext(), "Missing session header.");
                using var header = JsonDocument.Parse(lines.Current, StrictJson);
                JsonElement root = header.RootElement;
                string id = root.GetProperty("id").GetString()!;
                Require(root.GetProperty("type").GetString() == "session" &&
                    root.GetProperty("version").GetInt32() == 4 &&
                    EncodeSessionId(id) == Path.GetFileName(directory) &&
                    root.GetProperty("createdAt").GetInt64() >= 0 && root.GetProperty("delegationDepth").GetInt64() >= 0 &&
                    root.EnumerateObject().All(property => SessionHeaderFields.Contains(property.Name)), "Unsupported session header.");
                bool seeded = root.GetProperty("isSeeded").GetBoolean();
                string source = seeded ? "seeded-session" : "session";
                Mark(root, source);

                long sequence = 0;
                bool inherited = false;
                while (lines.MoveNext())
                {
                    using var record = JsonDocument.Parse(lines.Current, StrictJson);
                    JsonElement entry = record.RootElement;
                    string? type = entry.GetProperty("type").GetString();
                    Require(!string.IsNullOrEmpty(type) && type != "session" &&
                        entry.GetProperty("seq").GetInt64() == sequence && entry.GetProperty("time").GetInt64() >= 0 &&
                        entry.TryGetProperty("data", out _), $"Invalid session record at sequence {sequence}.");
                    if (type == "session/end-seed" && entry.GetProperty("data").TryGetProperty("inherited", out var marker))
                        inherited |= marker.GetBoolean();
                    Mark(entry, source);
                    sequence++;
                }

                Require(sequence > 0, "Header-only journal has no events to verify.");
                Require(seeded == inherited, "Missing or unexpected inherited seed marker.");
                Require(sessionIds.Add(id), "Duplicate session identifier across project directories.");
                sessions++;
                if (seeded) seededSessions++;
            });
        }
    }

    private static string EncodeSessionId(string id)
    {
        Require(!string.IsNullOrEmpty(id), "Invalid session identifier.");
        bool escapeDots = id is "." or "..";
        var encoded = new StringBuilder(id.Length);
        foreach (char unit in id)
        {
            if (!escapeDots && (char.IsAsciiLetterOrDigit(unit) || unit is '.' or '_' or '-'))
                encoded.Append(unit);
            else
                encoded.Append('~').Append(((int)unit).ToString("X4", CultureInfo.InvariantCulture));
        }

        return encoded.ToString();
    }

    private static IEnumerable<string> JsonLines(Stream stream)
    {
        Require(stream.Length > 0, "Empty JSONL input.");
        stream.Position = stream.Length - 1;
        Require(stream.ReadByte() == '\n', "JSONL input ends with an incomplete record.");
        stream.Position = 0;
        using var reader = new StreamReader(stream, Utf8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        while (reader.ReadLine() is { } line) yield return line;
    }

    private static IEnumerable<string> CompressedLines(FileStream file)
    {
        using var node = new ReadOnlyNode(ZstdDecoder, "", input: true);
        using var bytes = new BinaryReader(file, Utf8, leaveOpen: true);
        while (file.Position < file.Length)
        {
            long start = file.Position;
            Require(bytes.ReadUInt32() == 0xFD2FB528, "Invalid Zstandard frame magic.");
            byte descriptor = bytes.ReadByte();
            // Harness writes standard, dictionary-free, checksummed frames.
            Require((descriptor & 0x1f) == 4, "Unsupported Zstandard frame descriptor.");
            bool singleSegment = (descriptor & 0x20) != 0;
            int sizeFlag = descriptor >> 6;
            int sizeBytes = sizeFlag == 0 ? (singleSegment ? 1 : 0) : 1 << sizeFlag;
            file.Position += sizeBytes + (singleSegment ? 0 : 1);

            int block;
            do
            {
                block = bytes.ReadByte() | (bytes.ReadByte() << 8) | (bytes.ReadByte() << 16);
                int type = (block >> 1) & 3;
                Require(type != 3, "Invalid Zstandard block type.");
                file.Position += type == 1 ? 1 : block >> 3;
            } while ((block & 1) == 0);

            long end = file.Position + 4; // Content checksum.
            Require(end <= file.Length, "Incomplete Zstandard frame.");
            Require(end - start <= 64 * 1024 * 1024, "Zstandard frame exceeds the scan limit.");
            file.Position = start;
            byte[] frame = bytes.ReadBytes((int)(end - start));
            Require(file.Position == end, "Zstandard frame changed during the scan.");
            node.Write(Convert.ToBase64String(frame));
            string encoded = node.Read() ?? throw new InvalidDataException("Zstandard decoder did not return a frame.");
            using var decoded = new MemoryStream(Convert.FromBase64String(encoded), writable: false);
            foreach (string line in JsonLines(decoded)) yield return line;
        }

        node.FinishInput();
        Require(node.Read() is null, "Unexpected Zstandard decoder output.");
        node.Complete();
    }

    private void ScanForms()
    {
        string path = At("qa-forms.db");
        long? database = view.File(path, optional: true);
        foreach (string suffix in new[] { "-wal", "-journal", "-shm" })
        {
            long? size = view.File(path + suffix, optional: true);
            Require(size is null || (database is not null && size == 0), "Forms database has SQLite recovery sidecars. Scan a cleanly closed database.");
        }

        if (database is null) return;
        Require(database > 0, "Empty forms database.");
        using var node = new ReadOnlyNode(FormsReader, path);
        while (node.Read() is { } line)
        {
            using var row = JsonDocument.Parse(line);
            JsonElement payload = row.RootElement[1];
            switch (row.RootElement[0].GetString())
            {
                case "form":
                    using (var form = JsonDocument.Parse(payload.GetString()!, StrictJson))
                    {
                        Require(form.RootElement.GetProperty("storage_version").GetInt32() == 1, "Unsupported form document version.");
                        Mark(form.RootElement, "form-document");
                    }
                    formRows++;
                    break;
                case "mutation":
                    using (var receipt = JsonDocument.Parse(payload.GetString()!, StrictJson))
                    {
                        Require(receipt.RootElement.ValueKind == JsonValueKind.Object, "Invalid form mutation receipt.");
                        Mark(receipt.RootElement, "form-mutation");
                    }
                    mutationRows++;
                    break;
                case "resource":
                    MarkText(payload.GetString()!, "form-resource");
                    resourceRows++;
                    break;
                default:
                    throw new InvalidDataException("Unexpected forms reader output.");
            }
        }

        node.Complete();
    }

    private void ScanProvenance()
    {
        string legacy = At("qa-sources.json");
        if (view.File(legacy, optional: true) is not null) ReadProvenance(legacy, "sessions");
        foreach (string path in view.Children(At("qa-sources"), optional: true))
        {
            Require(Path.GetExtension(path) == ".json", "Unrecognized QA provenance file or staging artifact.");
            view.File(path);
            ReadProvenance(path, "turns");
        }
    }

    private void ReadProvenance(string path, string entriesKey)
    {
        using var input = System.IO.File.OpenRead(path);
        using var document = JsonDocument.Parse(input, StrictJson);
        var root = document.RootElement;
        Require(root.GetProperty("version").GetInt32() == 1 && root.GetProperty(entriesKey).ValueKind == JsonValueKind.Object,
            "Unsupported QA provenance layout.");
        Mark(root, "qa-provenance");
    }

    private void CheckPurgeJournal()
    {
        foreach (string journal in view.Children(At(".qa-session-purges"), optional: true))
            Require(view.Children(journal).Length == 0, "Pending account session purge can still restore history.");
    }

    private void ReadStore()
    {
        string root = At("attachments", "v1");
        Require(view.Children(At("attachments")).SequenceEqual(new[] { root }), "Expected only the local v1 attachment store.");
        string[] areas = view.Children(root);
        Require(areas.All(path => Path.GetFileName(path) is "file-objects" or "files" or "objects" or "request-images" or "tmp"),
            "Unrecognized attachment storage area.");
        Require(view.Children(Path.Combine(root, "tmp"), optional: true).Length == 0, "Attachment staging directory is not empty.");
        ReadFiles(Path.Combine(root, "file-objects"), aliases: false);
        ReadFiles(Path.Combine(root, "files"), aliases: true);
    }

    private void ReadFiles(string root, bool aliases)
    {
        foreach (string prefixPath in view.Children(root, optional: true))
        {
            string prefix = Path.GetFileName(prefixPath);
            Require(prefix.Length == 2 && prefix.All(IsLowerHex), "Invalid attachment shard name.");
            foreach (string path in view.Children(prefixPath))
            {
                string digest = Path.GetFileName(path);
                Require(digest.Length == 64 && digest.StartsWith(prefix, StringComparison.Ordinal) && digest.All(IsLowerHex),
                    "Invalid attachment digest or shard.");
                if (!files.TryGetValue(digest, out var group)) files.Add(digest, group = new());
                if (aliases)
                {
                    foreach (string alias in view.Children(path))
                    {
                        view.File(alias);
                        group.Aliases.Add(alias);
                    }
                }
                else
                {
                    view.File(path);
                    group.Object = path;
                }
            }
        }
    }

    private static bool IsLowerHex(char character) => character is >= '0' and <= '9' or >= 'a' and <= 'f';

    private void Classify(List<ObjectReport> kept, List<ObjectReport> candidates)
    {
        string[] paths = files.Values.SelectMany(group => group.Paths()).ToArray();
        var stats = ReadStats(paths);
        foreach ((string digest, StoredFile group) in files)
        {
            string? path = group.Object;
            Check("file-group", path ?? group.Aliases.FirstOrDefault() ?? At("attachments", "v1", "files"), () =>
            {
                Require(path is not null, "Attachment alias directory has no canonical object.");
                LinkStat stat = stats[path!];
                Require(stat.LinkCount == group.Aliases.Count + 1 && group.Aliases.All(alias => stats[alias] == stat),
                    "Attachment hard links do not match the inventory.");
                var reasons = new List<string>();
                if (references.TryGetValue(digest, out var from)) reasons.AddRange(from);
                if (DateTimeOffset.FromUnixTimeMilliseconds(stat.ModifiedMs) > scannedAt.AddDays(-minimumAgeDays))
                    reasons.Add("minimum-age");

                var item = new ObjectReport(digest, stat.Bytes, view.Relative(path!), group.Aliases.Select(view.Relative).ToArray(), reasons);
                if (reasons.Count > 0)
                {
                    kept.Add(item);
                    return;
                }

                using var input = System.IO.File.OpenRead(path!);
                Require(Convert.ToHexStringLower(SHA256.HashData(input)) == digest, "Canonical object content does not match its digest.");
                candidates.Add(item);
            });
        }

        var finalStats = ReadStats(paths);
        Require(paths.All(path => stats[path] == finalStats[path]), "Attachment identity changed during the scan.");
    }

    private static Dictionary<string, LinkStat> ReadStats(string[] paths)
    {
        var stats = new Dictionary<string, LinkStat>(StringComparer.Ordinal);
        if (paths.Length == 0) return stats;
        using var node = new ReadOnlyNode(StatReader, "", input: true);
        foreach (string path in paths)
        {
            node.Write(JsonSerializer.Serialize(path, InventoryJson.Default.String));
            using var row = JsonDocument.Parse(node.Read() ?? throw new InvalidDataException("Unable to read attachment identity."));
            var value = row.RootElement;
            stats.Add(path, new(value[0].GetString()!, value[1].GetString()!, value[2].GetInt64(), value[3].GetInt64(),
                value[4].GetInt64(), value[5].GetString()!));
        }
        node.FinishInput();
        Require(node.Read() is null, "Unexpected file identity output.");
        node.Complete();
        return stats;
    }

    private void Mark(JsonElement element, string source)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                MarkText(element.GetString()!, source);
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) Mark(item, source);
                break;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    MarkText(property.Name, source);
                    Mark(property.Value, source);
                }
                break;
        }
    }

    private void MarkText(string value, string source)
    {
        foreach (Match match in Digest.Matches(value))
        {
            string key = match.Value.ToLowerInvariant();
            if (!references.TryGetValue(key, out var sources)) references.Add(key, sources = new(StringComparer.Ordinal));
            sources.Add(source);
        }
    }

    private string At(params string[] parts) => Path.Combine(home, Path.Combine(parts));

    private void Check(string stage, string path, Action action)
    {
        try { action(); }
        catch (Exception error) when (error is InvalidDataException or IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or
            InvalidOperationException or FormatException or ArgumentException or Win32Exception)
        {
            // Exception messages from files and JSON can include profile contents or absolute paths.
            blockers.Add(new(stage, view.Relative(path), error is InvalidDataException ? error.Message : error.GetType().Name));
        }
    }

    internal static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidDataException(message);
    }

    internal sealed record ScanReport(int Version, string Mode, DateTimeOffset ScannedAt, int MinimumAgeDays, bool Complete,
        List<Blocker> Blockers, Counts Scanned, long CandidateLogicalBytes, List<ObjectReport> Candidates, List<ObjectReport> Kept);
    internal sealed record Counts(int Sessions, int SeededSessions, int FormRows, int MutationRows, int ResourceRows, int FileGroups);
    internal sealed record Blocker(string Stage, string Path, string Reason);
    internal sealed record ObjectReport(string Sha256, long Bytes, string Object, string[] Aliases, List<string> Reasons);
    private sealed record LinkStat(string Device, string Inode, long LinkCount, long Bytes, long ModifiedMs, string ChangedNs);

    private sealed class StoredFile
    {
        public string? Object { get; set; }
        public List<string> Aliases { get; } = [];
        public IEnumerable<string> Paths() => Object is null ? Aliases : Aliases.Prepend(Object);
    }

    private const string ZstdDecoder = """
        const { createInterface } = require('node:readline');
        const { zstdDecompressSync } = require('node:zlib');
        (async () => {
          for await (const frame of createInterface({ input: process.stdin })) {
            const decoded = zstdDecompressSync(Buffer.from(frame, 'base64'), { maxOutputLength: 128 * 1024 * 1024 });
            process.stdout.write(decoded.toString('base64') + '\n');
          }
        })().catch(() => { process.exitCode = 1; process.stdin.destroy(); });
        """;

    private const string FormsReader = """
        const { createHash } = require('node:crypto');
        const { once } = require('node:events');
        const { pathToFileURL } = require('node:url');
        const { DatabaseSync } = require('node:sqlite');
        const file = pathToFileURL(process.argv[1]);
        file.searchParams.set('immutable', '1');
        const db = new DatabaseSync(file.href, { readOnly: true });
        async function emit(kind, value) {
          if (!process.stdout.write(JSON.stringify([kind, value]) + '\n')) await once(process.stdout, 'drain');
        }
        (async () => {
          try {
            db.exec('PRAGMA trusted_schema = OFF');
            const check = db.prepare('PRAGMA quick_check').all();
            if (check.length !== 1 || check[0].quick_check !== 'ok') throw new Error('SQLite integrity');
            const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
            if (tables.map(({ name }) => name).join(',') !== 'forms,mutations,qa_meta,resources' ||
                db.prepare("SELECT value FROM qa_meta WHERE key = 'schema_version'").get()?.value !== '1') {
              throw new Error('Unsupported forms schema');
            }
            for (const { document } of db.prepare('SELECT document FROM forms').iterate()) await emit('form', document);
            for (const { result } of db.prepare('SELECT result FROM mutations').iterate()) await emit('mutation', result);
            for (const { data } of db.prepare('SELECT data FROM resources').iterate()) {
              if (!(data instanceof Uint8Array)) throw new Error('Invalid form resource');
              await emit('resource', createHash('sha256').update(data).digest('hex'));
            }
          } finally { db.close(); }
        })().catch(() => { process.exitCode = 1; });
        """;

    private const string StatReader = """
        const { createInterface } = require('node:readline');
        const { lstatSync } = require('node:fs');
        (async () => {
          for await (const line of createInterface({ input: process.stdin })) {
            const stat = lstatSync(JSON.parse(line), { bigint: true });
            if (!stat.isFile() || stat.ino === 0n) throw new Error('Unknown file identity');
            process.stdout.write(JSON.stringify([String(stat.dev), String(stat.ino), Number(stat.nlink),
              Number(stat.size), Number(stat.mtimeMs), String(stat.ctimeNs)]) + '\n');
          }
        })().catch(() => { process.exitCode = 1; process.stdin.destroy(); });
        """;
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]
[JsonSerializable(typeof(AttachmentInventory.ScanReport))]
[JsonSerializable(typeof(string))]
internal partial class InventoryJson : JsonSerializerContext;

sealed class ProfileView(string home)
{
    private readonly Dictionary<string, Stamp?> files = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string[]?> directories = new(StringComparer.Ordinal);

    public string Relative(string path) => Path.GetRelativePath(home, path).Replace('\\', '/');

    public void CheckHome()
    {
        for (DirectoryInfo? current = new(home); current is not null; current = current.Parent)
            AttachmentInventory.Require(Attributes(current.FullName, optional: false)!.Value.HasFlag(FileAttributes.Directory),
                "Expected a real profile directory.");
    }

    public long? File(string path, bool optional = false)
    {
        Stamp? stamp = GetStamp(path, optional);
        files.Add(path, stamp);
        return stamp?.Length;
    }

    public string[] Children(string path, bool optional = false)
    {
        string[]? contents = GetChildren(path, optional);
        directories.Add(path, contents);
        return contents ?? [];
    }

    public void Verify()
    {
        CheckHome();
        foreach ((string path, string[]? before) in directories)
        {
            string[]? after = GetChildren(path, optional: true);
            AttachmentInventory.Require(before is null ? after is null : after is not null && before.SequenceEqual(after),
                $"Directory inventory changed during the scan ({Relative(path)}).");
        }
        foreach ((string path, Stamp? before) in files)
            AttachmentInventory.Require(before == GetStamp(path, optional: true), $"File changed during the scan ({Relative(path)}).");
    }

    private static string[]? GetChildren(string path, bool optional)
    {
        var attributes = Attributes(path, optional);
        if (attributes is null) return null;
        AttachmentInventory.Require(attributes.Value.HasFlag(FileAttributes.Directory), "Unexpected entry where a directory was expected.");
        return Directory.GetFileSystemEntries(path).Order(StringComparer.Ordinal).ToArray();
    }

    private static Stamp? GetStamp(string path, bool optional)
    {
        var attributes = Attributes(path, optional);
        if (attributes is null) return null;
        AttachmentInventory.Require((attributes.Value & (FileAttributes.Directory | FileAttributes.Device)) == 0, "Expected a regular file.");
        var file = new FileInfo(path);
        return new(file.Length, file.LastWriteTimeUtc, file.CreationTimeUtc);
    }

    private static FileAttributes? Attributes(string path, bool optional)
    {
        try
        {
            var attributes = System.IO.File.GetAttributes(path);
            AttachmentInventory.Require(!attributes.HasFlag(FileAttributes.ReparsePoint), "Symbolic link or reparse point in scan scope.");
            return attributes;
        }
        catch (FileNotFoundException) when (optional) { return null; }
        catch (DirectoryNotFoundException) when (optional) { return null; }
    }

    private sealed record Stamp(long Length, DateTime Modified, DateTime Created);
}

sealed class ReadOnlyNode : IDisposable
{
    private readonly Process process;
    private readonly Task<string> stderr;

    public ReadOnlyNode(string code, string argument, bool input = false)
    {
        var start = new ProcessStartInfo("node")
        {
            UseShellExecute = false,
            RedirectStandardInput = input,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = new UTF8Encoding(false, true),
        };
        if (input) start.StandardInputEncoding = new UTF8Encoding(false, true);
        start.Environment.Remove("NODE_OPTIONS");
        start.Environment.Remove("NODE_PATH");
        foreach (string item in new[] { "--no-warnings", "-e", code, "--", argument }) start.ArgumentList.Add(item);
        process = Process.Start(start) ?? throw new IOException("Could not start the Node reader.");
        stderr = process.StandardError.ReadToEndAsync();
    }

    public void Write(string line)
    {
        process.StandardInput.WriteLine(line);
        process.StandardInput.Flush();
    }

    public void FinishInput() => process.StandardInput.Close();

    public string? Read() => process.StandardOutput.ReadLine();

    public void Complete()
    {
        process.WaitForExit();
        stderr.GetAwaiter().GetResult();
        AttachmentInventory.Require(process.ExitCode == 0, $"Node reader failed (exit {process.ExitCode}).");
    }

    public void Dispose()
    {
        if (!process.HasExited) process.Kill();
        process.Dispose();
    }
}
