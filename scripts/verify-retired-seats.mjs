/** Static syntax inspection only: audited source modules are never imported. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const retired = new Set([
  "settings.plugin.item",
  "settings.plugins.tab",
  "plugins.item",
]);
const extensions = /\.[cm]?[jt]sx?$/u;
const helpers = new Set(["registerSettingsCard", "registerSettingsSlot"]);

function sourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        ["node_modules", "lib", "dist", "coverage", "tests"].includes(
          entry.name,
        )
      )
        continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extensions.test(entry.name)) files.push(full);
    }
  };
  for (const group of ["plugins", "packages"]) {
    const parent = path.join(root, group);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(parent, entry.name, "src"));
    }
  }
  return files;
}

/** Bindings are resolved in their lexical scope, including imported static values. */
export function inspectSeatSources(sources, { workspacePackages = [] } = {}) {
  const parsed = new Map();
  const findings = [];
  for (const [file, text] of sources) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    parsed.set(path.resolve(file), source);
    for (const diagnostic of source.parseDiagnostics) {
      findings.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
        rule: "seat-source-unreadable",
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      });
    }
    if (
      /(?:^|[/\\])(?:tab-labels|settings-tab-label)\.[cm]?[jt]sx?$/u.test(file)
    ) {
      findings.push({
        file,
        line: 1,
        rule: "orphan-tab-labels",
        message:
          "remove the label table left behind by the retired tab surface",
      });
    }
  }

  const unwrap = (node) => {
    while (
      node &&
      (ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isTypeAssertionExpression(node))
    )
      node = node.expression;
    return node;
  };
  const scope = (node) => {
    while (
      node &&
      !ts.isSourceFile(node) &&
      !ts.isBlock(node) &&
      !ts.isFunctionLike(node)
    )
      node = node.parent;
    return node;
  };
  const declarations = new Map();
  const imports = new Map();
  for (const source of parsed.values()) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const owner = scope(node.parent);
        if (!declarations.has(owner)) declarations.set(owner, new Map());
        declarations.get(owner).set(node.name.text, node.initializer);
      }
      if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        if (!declarations.has(node.parent))
          declarations.set(node.parent, new Map());
        declarations.get(node.parent).set(node.name.text, node.initializer);
      }
      if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const owner = scope(node.parent);
        if (!declarations.has(owner)) declarations.set(owner, new Map());
        declarations.get(owner).set(node.name.text, node.initializer);
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const specifier of bindings.elements)
            imports.set(`${source.fileName}#${specifier.name.text}`, {
              module: node.moduleSpecifier.text,
              name: specifier.propertyName?.text ?? specifier.name.text,
            });
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          imports.set(`${source.fileName}#${bindings.name.text}`, {
            module: node.moduleSpecifier.text,
            name: "*",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const importedSource = (source, module) => {
    let target;
    if (module.startsWith("."))
      target = path.resolve(path.dirname(source.fileName), module);
    else {
      const owner = workspacePackages.find(
        (entry) => module === entry.name || module.startsWith(`${entry.name}/`),
      );
      if (!owner) return undefined;
      const key =
        module === owner.name ? "." : `.${module.slice(owner.name.length)}`;
      const entry = owner.exports?.[key];
      const exported =
        typeof entry === "string" ? entry : (entry?.default ?? entry?.import);
      if (typeof exported !== "string") return undefined;
      target = path.resolve(
        owner.directory,
        exported.replace(/^\.\/lib\//u, "./src/"),
      );
    }
    const stem = target.replace(/\.[cm]?js$/u, "");
    return [
      target,
      ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"].map(
        (ext) => stem + ext,
      ),
      path.join(target, "index.ts"),
      path.join(target, "index.tsx"),
    ]
      .map((file) => parsed.get(file))
      .find(Boolean);
  };
  const exportedBinding = (source, name, seen = new Set()) => {
    const key = `${source.fileName}#${name}`;
    if (seen.has(key)) return undefined;
    seen = new Set(seen).add(key);
    const local = declarations.get(source)?.get(name);
    if (local) return local;
    for (const statement of source.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const target = importedSource(source, statement.moduleSpecifier.text);
      if (!target) continue;
      if (!statement.exportClause) {
        const value = exportedBinding(target, name, seen);
        if (value) return value;
      } else if (ts.isNamedExports(statement.exportClause)) {
        const specifier = statement.exportClause.elements.find(
          (element) => element.name.text === name,
        );
        if (specifier)
          return exportedBinding(
            target,
            specifier.propertyName?.text ?? specifier.name.text,
            seen,
          );
      }
    }
    return undefined;
  };
  const binding = (node) => {
    let owner = scope(node.parent);
    while (owner) {
      if (declarations.get(owner)?.has(node.text))
        return declarations.get(owner).get(node.text);
      owner = scope(owner.parent);
    }
    const source = node.getSourceFile();
    const imported = imports.get(`${source.fileName}#${node.text}`);
    const target =
      imported === undefined
        ? undefined
        : importedSource(source, imported.module);
    return target === undefined
      ? undefined
      : exportedBinding(target, imported.name);
  };
  const property = (node, key, seen = new Set()) => {
    node = unwrap(node);
    if (!node || seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (ts.isIdentifier(node)) return property(binding(node), key, seen);
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    let value;
    for (const member of node.properties) {
      if (ts.isSpreadAssignment(member))
        value = property(member.expression, key, seen) ?? value;
      else if (
        (ts.isPropertyAssignment(member) ||
          ts.isShorthandPropertyAssignment(member)) &&
        member.name
          .getText(node.getSourceFile())
          .replace(/^["'`]|["'`]$/gu, "") === key
      )
        value = ts.isPropertyAssignment(member)
          ? member.initializer
          : member.name;
    }
    return value;
  };
  const values = (node, seen = new Set()) => {
    node = unwrap(node);
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return [node.text];
    if (ts.isIdentifier(node)) return values(binding(node), seen);
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const source = node.getSourceFile();
        const imported = imports.get(
          `${source.fileName}#${node.expression.text}`,
        );
        const target =
          imported?.name === "*"
            ? importedSource(source, imported.module)
            : undefined;
        if (target)
          return values(exportedBinding(target, node.name.text), seen);
      }
      return values(property(node.expression, node.name.text), seen);
    }
    if (ts.isElementAccessExpression(node))
      return values(
        property(node.expression, values(node.argumentExpression, seen)[0]),
        seen,
      );
    if (ts.isConditionalExpression(node))
      return [...values(node.whenTrue, seen), ...values(node.whenFalse, seen)];
    if (ts.isBinaryExpression(node)) {
      const left = values(node.left, seen),
        right = values(node.right, seen);
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken)
        return left.flatMap((a) => right.map((b) => a + b));
      if (
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
        ].includes(node.operatorToken.kind)
      )
        return [...left, ...right];
    }
    if (ts.isTemplateExpression(node)) {
      let out = [node.head.text];
      for (const span of node.templateSpans)
        out = out.flatMap((prefix) =>
          values(span.expression, seen).map(
            (value) => prefix + value + span.literal.text,
          ),
        );
      return out;
    }
    return [];
  };
  const slotReceiver = (node, seen = new Set()) => {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    if (ts.isPropertyAccessExpression(node)) return node.name.text === "slots";
    if (ts.isIdentifier(node))
      return (
        node.text === "slots" ||
        slotReceiver(binding(node), new Set(seen).add(node))
      );
    return false;
  };
  const callee = (node, seen = new Set()) => {
    node = unwrap(node);
    if (!node || seen.has(node)) return undefined;
    if (ts.isIdentifier(node))
      return callee(binding(node), new Set(seen).add(node)) ?? node;
    return node;
  };
  let registrations = 0;
  let dynamic = 0;
  const unresolved = [];
  for (const source of parsed.values()) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const call = callee(node.expression);
        let seat;
        if (
          call &&
          ts.isPropertyAccessExpression(call) &&
          slotReceiver(call.expression)
        ) {
          if (call.name.text === "register")
            seat = property(node.arguments[0], "name");
          if (call.name.text === "inject") seat = node.arguments[0];
        } else if (call && ts.isIdentifier(call)) {
          const imported = imports.get(`${source.fileName}#${call.text}`);
          const helperName =
            imported?.module === "@yadsh/dsh-plugin-kit/client"
              ? imported.name
              : call.text;
          if (helpers.has(helperName))
            seat = property(node.arguments[1], "slotName");
        } else if (
          call &&
          ts.isPropertyAccessExpression(call) &&
          ts.isIdentifier(call.expression)
        ) {
          const imported = imports.get(
            `${source.fileName}#${call.expression.text}`,
          );
          if (
            imported?.module === "@yadsh/dsh-plugin-kit/client" &&
            imported.name === "*" &&
            helpers.has(call.name.text)
          )
            seat = property(node.arguments[1], "slotName");
        }
        if (seat) {
          registrations += 1;
          const resolved = values(seat);
          if (resolved.length === 0) {
            dynamic += 1;
            unresolved.push({
              file: source.fileName,
              line:
                source.getLineAndCharacterOfPosition(seat.getStart(source))
                  .line + 1,
            });
          }
          for (const name of new Set(resolved))
            if (retired.has(name))
              findings.push({
                file: source.fileName,
                line:
                  source.getLineAndCharacterOfPosition(seat.getStart(source))
                    .line + 1,
                rule: "retired-seat",
                message: `registration can mount on retired seat ${name}; use the current Plugins panel contract`,
              });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { files: sources.size, registrations, dynamic, unresolved, findings };
}

export function verifyRetiredSeats(repoRoot = process.cwd()) {
  const workspacePackages = [];
  for (const group of ["plugins", "packages"]) {
    const parent = path.join(repoRoot, group);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const directory = path.join(parent, entry.name);
      const manifest = path.join(directory, "package.json");
      if (entry.isDirectory() && existsSync(manifest))
        workspacePackages.push({
          ...JSON.parse(readFileSync(manifest, "utf8")),
          directory,
        });
    }
  }
  return inspectSeatSources(
    new Map(
      sourceFiles(repoRoot).map((file) => [file, readFileSync(file, "utf8")]),
    ),
    { workspacePackages },
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = verifyRetiredSeats();
  for (const site of result.unresolved)
    process.stdout.write(
      `${path.relative(process.cwd(), site.file)}:${site.line}: dynamic seat value not certified statically\n`,
    );
  for (const finding of result.findings)
    process.stderr.write(
      `${path.relative(process.cwd(), finding.file)}:${finding.line}: [${finding.rule}] ${finding.message}\n`,
    );
  process.stdout.write(
    `retired seats: ${result.files} source file(s), ${result.registrations} seat expression(s), ${result.dynamic} dynamic seat(s) unresolved, ${result.findings.length} violation(s)\n`,
  );
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}
