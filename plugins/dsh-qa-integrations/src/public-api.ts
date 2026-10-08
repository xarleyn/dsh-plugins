/**
 * The published surface of this package, in one list.
 *
 * The plugin's composition root and this list answer different questions — which
 * providers a deployment mounts, and which names another plugin may import from
 * @yadsh/dsh-qa-integrations — so they live apart: adding a provider adds its own
 * row to the list and its own module, and changes nothing about how the plugin is
 * composed. The entry module re-exports this file, so a consumer of the package
 * cannot tell the two apart, which is the point.
 */

export { IntegrationBroker } from "./broker.js";
export {
  ConfigSchema,
  resolveConfig,
  snapshotConfig,
  type LiveQaIntegrationsConfig,
  type QaIntegrationsConfig,
  type QaIntegrationsSnapshot,
  type ResolvedQaIntegrationsConfig,
} from "./config.js";
export {
  MANAGED_SERVICE_CREDENTIALS_DEFAULTS,
  managedServiceCredentialsSchema,
  resolveManagedServiceCredentials,
  type ManagedServiceCredentialProfileConfig,
  type ManagedServiceCredentialProfileInput,
  type ManagedServiceCredentialsConfig,
  type ManagedServiceCredentialsInput,
} from "./service-credentials/config.js";
export {
  evaluateServiceOperation,
  narrowBoundary,
  SERVICE_CEILING,
  type ServiceOperationQuery,
  type ServicePolicyDecision,
} from "./service-credentials/policy.js";
export { ServiceCredentialRegistry } from "./service-credentials/registry.js";
export { operationCapabilityServiceState } from "./service-credentials/state.js";
export { profilePolicyRevision } from "./service-credentials/config.js";
export {
  CREDENTIAL_SOURCES,
  isCredentialSource,
  UNCLASSIFIED_OPERATION,
  type CredentialSource as ManagedCredentialSource,
  type DataSensitivity,
  type OperationEffect,
  type OperationSecurityMetadata,
  type OperationServiceDecision,
  type ResolvedCredentialContext,
  type ResolvedServiceCredential,
  type SafeExternalIdentity,
  type ServiceCredentialHealth,
  type ServiceCredentialProfile,
  type ServiceCredentialStatus,
  type ServiceResourceBoundary,
} from "./service-credentials/types.js";
export { IntegrationError } from "./errors.js";
export {
  BITRIX_CAPABILITIES,
  BITRIX_OPERATIONS,
  BITRIX24_CAPABILITY_INFO,
  bitrix24OperationCapability,
  enabledCapabilities,
  type Bitrix24Capability,
  type Bitrix24CapabilityDefinition,
  type BitrixOperationDefinition,
} from "./providers/bitrix24/catalog.js";
export {
  BITRIX24_DEFAULTS,
  bitrix24ConfigSchema,
  resolveBitrix24Config,
  type Bitrix24Flags,
} from "./providers/bitrix24/config.js";
export {
  Bitrix24Provider,
  parseBitrixWebhook,
} from "./providers/bitrix24/index.js";
export {
  BITRIX_HANDLERS,
  BITRIX_PROJECTIONS,
} from "./providers/bitrix24/operations.js";
export {
  createBitrix24Tools,
  BITRIX24_TOOL_NAMES,
} from "./providers/bitrix24/tools.js";
export {
  GitlabProvider,
  groupAllowed as gitlabGroupAllowed,
  projectAllowed as gitlabProjectAllowed,
} from "./providers/gitlab/index.js";
export {
  GITLAB_CAPABILITIES,
  GITLAB_CAPABILITY_INFO,
  GITLAB_CI_SPLIT_CAPABILITIES,
  GITLAB_LEGACY_CI_CAPABILITY,
  GITLAB_OPERATIONS,
  GITLAB_RESOURCE_KIND,
  capabilitiesForScopes,
  gitlabOperationCapability,
  gitlabOperationMetadata,
  type GitlabCapability,
  type GitlabCapabilityDefinition,
  type GitlabOperationDefinition,
} from "./providers/gitlab/catalog.js";
export {
  GITLAB_DEFAULTS,
  gitlabConfigSchema,
  resolveGitlabConfig,
  type GitlabConfigInput,
  type GitlabFlags,
  type GitlabInstance,
} from "./providers/gitlab/config.js";
export {
  createGitlabTools,
  GITLAB_TOOL_NAMES,
} from "./providers/gitlab/tools.js";
export {
  GitlabTransport,
  credentialFromPlaintext as gitlabCredentialFromPlaintext,
  credentialInstance,
  type GitlabCredential,
} from "./providers/gitlab/transport.js";
export {
  GITLAB_HANDLERS,
  GITLAB_PROJECTIONS,
} from "./providers/gitlab/operations.js";
export { ConfluenceProvider } from "./providers/confluence/index.js";
export {
  adfToText as confluenceAdfToText,
  textBudget,
} from "./providers/confluence/adf.js";
export {
  CONFLUENCE_CAPABILITIES,
  CONFLUENCE_CAPABILITY_INFO,
  CONFLUENCE_OPERATIONS,
  confluenceOperationCapability,
  type ConfluenceCapability,
  type ConfluenceCapabilityDefinition,
  type ConfluenceOperationDefinition,
} from "./providers/confluence/catalog.js";
export {
  CONFLUENCE_DEFAULTS,
  confluenceConfigSchema,
  resolveConfluenceConfig,
  spaceAllowed,
  type ConfluenceFlags,
  type ConfluenceInstance,
} from "./providers/confluence/config.js";
export {
  buildCql,
  cqlLiteral,
  CONTENT_TYPES,
  ORDER_BY,
  type ConfluenceOrder,
  type ConfluenceSearchFilter,
} from "./providers/confluence/cql.js";
export {
  COMMENT_KINDS,
  CONFLUENCE_HANDLERS,
  CONFLUENCE_PROJECTIONS,
  DEFAULT_LIMIT,
  bodyLimit,
  commentChildrenPath,
  commentCollections,
  commentKind,
  commentPath,
  commentReplies,
  isNumericSpace,
  modifiedAfterDate,
  numericId,
  offsetCursor,
  pageLimit,
  plainExcerpt,
  spaceRef,
  upstreamCursor,
  type ConfluenceCommentKind,
  type ConfluenceProjection,
  type ConfluenceProjectionContext,
  type ConfluenceRequest,
} from "./providers/confluence/operations.js";
export {
  createConfluenceTools,
  CONFLUENCE_TOOL_NAMES,
} from "./providers/confluence/tools.js";
export {
  ConfluenceTransport,
  credentialFromPlaintext as confluenceCredentialFromPlaintext,
  credentialInstance as confluenceCredentialInstance,
  type ConfluenceCredential,
} from "./providers/confluence/transport.js";
export {
  TeamcityProvider,
  buildTypeAllowed as teamcityBuildTypeAllowed,
  projectAllowed as teamcityProjectAllowed,
} from "./providers/teamcity/index.js";
export {
  TEAMCITY_CAPABILITIES,
  TEAMCITY_CAPABILITY_INFO,
  TEAMCITY_INSTANCE_ID,
  TEAMCITY_OPERATIONS,
  TEAMCITY_RESOURCE_KIND,
  TEAMCITY_STREAM_OPERATIONS,
  enabledCapabilities as enabledTeamcityCapabilities,
  teamcityOperationCapability,
  teamcityOperationMetadata,
  type TeamCityCapability,
  type TeamCityCapabilityDefinition,
  type TeamCityOperationDefinition,
} from "./providers/teamcity/catalog.js";
export {
  TEAMCITY_DEFAULTS,
  DEFAULT_LOG_LINES,
  resolveTeamCityConfig,
  teamcityConfigSchema,
  type TeamCityConfigInput,
  type TeamCityFlags,
} from "./providers/teamcity/config.js";
export {
  artifactBinaryProblem,
  artifactByteLimit,
  artifactPath,
  textArtifact,
  type ArtifactPath,
} from "./providers/teamcity/artifacts.js";
export {
  LOG_MODES,
  logLines,
  logMode,
  sanitizeLog,
  selectLogWindow,
  trimToBytes,
  type LogMode,
  type LogWindow,
} from "./providers/teamcity/logs.js";
export {
  PRIVATE_CIDRS,
  canonicalServerUrl,
  cidrProblem,
  hostPatternProblem,
  isIpLiteral,
  serverUrlProblem,
  type TeamCityNetworkMode,
  type TeamCityNetworkPolicy,
} from "./providers/teamcity/network.js";
export {
  buildBuildLocator,
  dimension,
  joinDimensions,
  locatorValue,
  nested,
  teamCityDate,
  type BuildLocatorInput,
} from "./providers/teamcity/locators.js";
export {
  TEAMCITY_HANDLERS,
  TEAMCITY_LIMITS,
  TEAMCITY_PROJECTIONS,
  isoDate,
  listLimit,
  type TeamCityProjection,
  type TeamCityRequest,
} from "./providers/teamcity/operations.js";
export {
  TeamCityTransport,
  configuredServer as teamcityConfiguredServer,
  credentialFromPlaintext as teamcityCredentialFromPlaintext,
  type TeamCityCredential,
} from "./providers/teamcity/transport.js";
export {
  createTeamcityTools,
  TEAMCITY_TOOL_NAMES,
} from "./providers/teamcity/tools.js";
export { JiraProvider } from "./providers/jira/index.js";
export {
  JIRA_CAPABILITIES,
  JIRA_CAPABILITY_INFO,
  JIRA_COMPANION_PATHS,
  JIRA_OPERATIONS,
  JIRA_READ_PATHS,
  enabledCapabilities as enabledJiraCapabilities,
  jiraOperationCapability,
  type JiraCapability,
  type JiraCapabilityDefinition,
  type JiraOperationDefinition,
} from "./providers/jira/catalog.js";
export {
  JIRA_DEFAULTS,
  SEARCH_PAGE_CAP,
  jiraConfigSchema,
  jiraSite,
  resolveJiraConfig,
  type JiraFlags,
  type JiraSite,
} from "./providers/jira/config.js";
export {
  adfToText as jiraAdfToText,
  bodyText,
  isAdf,
  type AdfText,
} from "./providers/jira/adf.js";
export {
  buildJql,
  commentLimit,
  commentStart,
  issueKey as jiraIssueKey,
  jqlDateValue,
  jqlLiteral,
  needsUserLookup,
  pageToken,
  projectKey as jiraProjectKey,
  searchLimit,
  textClauses,
  textMatch,
  type CustomFieldClause,
} from "./providers/jira/jql.js";
export {
  ISSUE_INCLUDES,
  JIRA_HANDLERS,
  JIRA_PROJECTIONS,
  SEARCH_FIELDS as JIRA_SEARCH_FIELDS,
  customFieldValue,
  issueFields,
  issueUrl,
  requestedIncludes,
  wantsFieldNames,
  type JiraProjection,
} from "./providers/jira/operations.js";
export {
  JiraTransport,
  basicAuthorization,
  credentialFromPlaintext as jiraCredentialFromPlaintext,
  credentialSite,
  type JiraCredential,
} from "./providers/jira/transport.js";
export { createJiraTools, JIRA_TOOL_NAMES } from "./providers/jira/tools.js";
export { TestitProvider } from "./providers/testit/index.js";
export {
  TESTIT_CAPABILITIES,
  TESTIT_CAPABILITY_INFO,
  TESTIT_OPERATIONS,
  enabledCapabilities as enabledTestitCapabilities,
  testitOperationCapability,
  type TestitCapability,
  type TestitCapabilityDefinition,
  type TestitListKind,
  type TestitOperationDefinition,
} from "./providers/testit/catalog.js";
export {
  TESTIT_DEFAULTS,
  resolveTestitConfig,
  testitConfigSchema,
  testitInstance,
  type TestitFlags,
  type TestitInstance,
} from "./providers/testit/config.js";
export {
  assertReadableSize,
  attachmentBinaryProblem,
  attachmentByteLimit,
  attachmentExtension,
  attachmentName,
} from "./providers/testit/attachments.js";
export {
  RESULT_OUTCOMES,
  TESTIT_HANDLERS,
  TESTIT_LIMITS,
  TESTIT_PROJECTIONS,
  TEST_RUN_STATES,
  WORK_ITEM_ENTITY_TYPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATES,
  bounded as testitBounded,
  capped,
  contentBlock as testitContentBlock,
  listLimit as testitListLimit,
  listOffset as testitListOffset,
  paged,
  type TestitProjection,
  type TestitProjectionContext,
  type TestitRequest,
} from "./providers/testit/operations.js";
export {
  TestitTransport,
  credentialFromPlaintext as testitCredentialFromPlaintext,
  credentialInstance as testitCredentialInstance,
  type TestitCredential,
  type TestitPage,
} from "./providers/testit/transport.js";
export {
  createTestitTools,
  TESTIT_TOOL_NAMES,
} from "./providers/testit/tools.js";
export { WeblateProvider } from "./providers/weblate/index.js";
export {
  WEBLATE_CAPABILITIES,
  WEBLATE_CAPABILITY_INFO,
  WEBLATE_OPERATIONS,
  enabledCapabilities as weblateEnabledCapabilities,
  weblateOperationCapability,
  type WeblateCapability,
  type WeblateCapabilityDefinition,
  type WeblateOperationDefinition,
} from "./providers/weblate/catalog.js";
export {
  WEBLATE_DEFAULTS,
  resolveWeblateConfig,
  weblateConfigSchema,
  weblateInstance,
  type WeblateFlags,
  type WeblateInstance,
} from "./providers/weblate/config.js";
export {
  WEBLATE_HANDLERS,
  WEBLATE_PROJECTIONS,
  WEBLATE_UNTRUSTED_OPERATIONS,
  accountFromUsers,
  componentRef,
  projectRef as weblateProjectRef,
  sameOriginUrl,
  translationRef as weblateTranslationRef,
  unitState as weblateUnitState,
  type WeblateProjection,
  type WeblateProjectionContext,
} from "./providers/weblate/operations.js";
export {
  FAILING_CHECK_CLAUSE,
  UNIT_STATE_FILTERS,
  UNIT_TEXT_FIELDS,
  buildUnitQuery,
  exactClause as weblateExactClause,
  quoteQueryValue,
  stateClause as weblateStateClause,
  textClause as weblateTextClause,
  type UnitStateFilter,
  type UnitTextField,
} from "./providers/weblate/query.js";
export {
  WeblateTransport,
  credentialFromPlaintext as weblateCredentialFromPlaintext,
  credentialInstance as weblateCredentialInstance,
  resultsOf,
  type WeblateCredential,
} from "./providers/weblate/transport.js";
export {
  createWeblateTools,
  WEBLATE_TOOL_NAMES,
} from "./providers/weblate/tools.js";
export { IntegrationProviderRegistry } from "./providers/registry.js";
export {
  serviceBoundaryOf,
  serviceResourceDenied,
} from "./providers/shared/service-boundary.js";
export { IntegrationRepository } from "./repository.js";
export {
  DockerSecretKeyProvider,
  MemoryKeyProvider,
  type KeyProvider,
} from "./secrets/key-provider.js";
export { SecretStore } from "./secrets/secret-store.js";
export { createToolKit, type ToolKitOptions } from "./tool-kit.js";
export {
  createIntegrationTools,
  INTEGRATION_TOOL_NAMES,
  integrationToolNames,
} from "./tools.js";
export type * from "./types.js";
export {
  BitrixTransport,
  credentialFromPlaintext,
  type BitrixCredential,
} from "./providers/bitrix24/transport.js";
