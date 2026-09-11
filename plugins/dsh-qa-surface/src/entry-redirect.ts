import { QA_NAVIGATION_MARKER } from "./navigation-marker.js";
import type { ResolvedQaSurfaceConfig } from "./types.js";

/**
 * The operator/LAN split is decided client-side on `location.hostname` on
 * purpose: behind the qa-deploy proxy every request appears loopback to the
 * Host, and the deployment convention is "operator uses localhost, QA users
 * use the LAN address". `?ui=admin` persists the operator escape hatch under
 * the deployment's storage key; `?ui=qa` clears it again.
 */
export function entryRedirectScript(config: ResolvedQaSurfaceConfig): string {
  const routePath = JSON.stringify(config.route.path);
  const marker = JSON.stringify(QA_NAVIGATION_MARKER);
  const flagKey = JSON.stringify(
    `${config.session.storageKey}:v1:${config.route.path}:entry-ui`,
  );
  return [
    "(function(){try{",
    "var s=new URLSearchParams(location.search);",
    `if(s.has(${marker}))return;`,
    `var k=${flagKey};`,
    "var ui=s.get('ui');",
    "if(ui==='admin'){try{localStorage.setItem(k,'admin')}catch(e){}return;}",
    "if(ui==='qa'){try{localStorage.removeItem(k)}catch(e){}}",
    "var f=null;try{f=localStorage.getItem(k)}catch(e){}",
    "if(f==='admin')return;",
    "var h=location.hostname;",
    "var loop=h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='[::1]'||h==='0.0.0.0'||/\\.localhost$/.test(h);",
    "if(!loop)location.replace(",
    routePath,
    ");",
    "}catch(e){}})();",
  ].join("");
}

export interface EntryRedirectRow {
  readonly kind: "script";
  readonly placement: "head";
  readonly text: string;
}

/**
 * The structured index-injection row for one config snapshot, or undefined
 * when the plugin is disabled or the redirect flag is off.
 */
export function entryRedirectRow(
  config: ResolvedQaSurfaceConfig,
): EntryRedirectRow | undefined {
  if (!config.enabled || !config.entry.redirectNonLoopback) return undefined;
  return {
    kind: "script",
    placement: "head",
    text: entryRedirectScript(config),
  };
}
