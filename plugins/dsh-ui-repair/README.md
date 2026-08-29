# dsh-ui-repair

![Status: specification](https://img.shields.io/badge/status-specification-orange.svg)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Planned compatibility and repair layer for visual problems in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin interfaces.

`dsh-ui-repair` is designed to detect layout regressions, propose narrowly scoped fixes, verify the result, and roll unsafe changes back without modifying third-party plugin source code.

[Specification](<dsh-ui-repair — спецификация плагина.md>)

## Installation

The plugin is not installable yet. This directory currently contains a design specification only; there is no package manifest, runtime bundle, or published npm package.

## The intended experience

```text
DSH Web UI
├─ Core UI
├─ Plugin A
├─ Plugin B
└─ dsh-ui-repair
   ├─ DOM and layout diagnostics
   ├─ scoped repair rules
   ├─ visual verification
   ├─ automatic rollback
   └─ repair history
```

The repair layer will observe the rendered interface, compare similar elements, and apply only high-confidence changes inside the affected plugin boundary.

## Planned MVP

- alignment checks for icons, labels, controls, and repeated rows;
- overflow and scroll-container diagnostics;
- size, spacing, typography, flex, grid, clipping, and position checks;
- scoped CSS repairs that do not leak into other plugins or the DSH core;
- `observe`, `suggest`, and `auto` modes;
- confidence scoring and preview before mutation;
- post-change visual verification with automatic rollback;
- repair history, ignore rules, and persistent fixes;
- `MutationObserver` and `ResizeObserver` integration with bounded work;
- a settings page and per-plugin diagnostics view;
- manual repair and extension rule APIs;
- accessibility and visual-regression coverage.

## Design boundaries

- Never edit or fork third-party plugin source code.
- Target repairs by plugin-owned DOM boundaries and stable selectors.
- Prefer the smallest local change that resolves a measured anomaly.
- Do not add scroll containers until the actual height constraint and existing scroll ownership are known.
- Treat clipping, sticky positioning, and responsive behavior as context-sensitive rather than automatically broken.
- Verify every automatic repair and remove it if the layout becomes worse or unstable.

## Development status

Implementation has not started. The first milestone is a proof of concept that identifies one icon-alignment defect and one settings overflow defect, applies scoped fixes, verifies both results, and demonstrates rollback without affecting neighboring plugins.

See the full [specification](<dsh-ui-repair — спецификация плагина.md>) for priorities, APIs, safety rules, test cases, and the proposed project structure.

## Contributing

Design feedback and focused pull requests are welcome. Read the monorepo [contribution guide](../../CONTRIBUTING.md) before starting implementation work.

## License

[MIT](../../LICENSE). This is an independent community project and is not affiliated with or endorsed by DeepSeek.
