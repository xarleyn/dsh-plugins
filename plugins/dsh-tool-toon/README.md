# @yadsh/dsh-tool-toon

Lossless TOON formatting for JSON tool results before they enter model context.
The optional host plugin encodes complete JSON object/array text blocks using
the official [TOON codec](https://github.com/toon-format/toon). It keeps all
fields and rows; no LLM or network request is needed for conversion.

## Features

- Shared formatting across tools, including Jira field catalogues and search lists.
- Canonical typed values, tool arguments and schemas remain unchanged.
- Prose, errors, images and nested programmatic calls pass through.
- Strict round-trip validation and bounded input size; conversion failures bypass.
- Fenced TOON is selected only when it beats **compact JSON** by the configured
  byte thresholds, including the fence overhead. UTF-8 bytes are a size heuristic,
  not a guarantee of savings under a provider's tokenizer.

## Requirements

- DeepSeek Harness >=0.1.7-rc.2 <0.3.0-0 with `tools/post-execute`
- Node.js ^22.19.0 or >=24.0.0

## Installation

```bash
dsh plugin --profile <profile> add @yadsh/dsh-tool-toon
```

`--profile` is required: `dsh plugin add <package>` rejects a call without one.
To install from a checkout of this monorepo instead:

```bash
pnpm --filter @yadsh/dsh-tool-toon build
dsh plugin --profile <profile> add ./plugins/dsh-tool-toon
```

To remove the plugin:

```bash
dsh plugin --profile <profile> remove @yadsh/dsh-tool-toon
```

## Configuration

Installing the plugin opts in. Configuration belongs to the `dsh-tool-toon` row:

```yaml
- insert:
    - id: dsh-tool-toon
      name: "@yadsh/dsh-tool-toon"
      config:
        enabled: true
        minBytes: 512
        maxBytes: 262144
        minSavingsBytes: 96
        minSavingsRatio: 0.15
        excludeTools: []
```

`enabled: false` restores the original output. `excludeTools` matches exact tool
names. Inputs above `maxBytes` pass through to existing CAS/offload processing;
this plugin does not truncate them. Small responses and shapes that do not
compress sufficiently also stay as they were. Numbers that would normalize
during JSON parsing, unsafe integers and nesting deeper than 64 bypass conversion.

TOON is most effective for uniform arrays of objects. For example:

```toon
items[3]{id,name,custom}:
  customfield_10000,Demo field A,true
  customfield_10001,Demo field B,true
  customfield_10002,Demo field C,true
```

This short example illustrates syntax; the default thresholds target larger
responses. The actual model-facing output includes a `toon` code fence.

## Composition

Register TOON **before** CAS/offload/JEV in the post-execute listener chain to
format after their downstream projections unwind. It always reads the accepted
content and never reconstructs fields removed by another processor. Other orders
preserve downstream decisions but can affect later classification or compression.
Code-mode nested dispatches keep their original values and text. Existing TOON
is not converted twice. Existing conversation history is not rewritten.

## Token measurements

Reproduce with `pnpm test` (`tests/token-savings.test.ts`). These are synthetic
100-field catalogues, compact JSON versus fenced TOON, using `gpt-tokenizer`
4.1.0. They are not production payloads or DeepSeek token measurements.

| Shape | cl100k JSON → TOON | o200k JSON → TOON | Default selection |
| --- | --- | --- | --- |
| Uniform field rows | 4404 → 2325 | 4105 → 2024 | TOON |
| Rows with `clauseNames` arrays | 6304 → 7209 | 5905 → 6608 | Keep original JSON |

Array-valued cells can prevent the table form. Converting every response
unconditionally would increase context use for the second shape.

## Specification

See [SPEC.md](https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-tool-toon/SPEC.md).

## Compatibility

- Installed Host API checked against `0.2.1-rc.3` (see `compatibility.json`).
- A deployment needs the package installed and its host process restarted before
  new tool calls use this format. Local tests do not establish live Jira or model acceptance.

## Development

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## License

MIT
