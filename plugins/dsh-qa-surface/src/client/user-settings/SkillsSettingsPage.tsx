import { useCallback, useEffect, useRef, useState } from "react";
import type {
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillSummary,
  QaSkillToolDescriptor,
} from "../../types.js";
import type { QaBoundSkillApi } from "../types.js";
import { QaSkillCatalog } from "./SkillCatalog.js";
import { QaSkillEditor, type QaSkillValidationState } from "./SkillEditor.js";
import { isSkillConflict, skillFailureCopy } from "./copy.js";

/** How long typing settles before the Host is asked about the draft. */
const VALIDATION_DEBOUNCE_MS = 350;

const NO_VALIDATION: QaSkillValidationState = {
  preview: "",
  diagnostics: [],
  pending: false,
};

export interface QaSkillsSettingsPageProps {
  /** The token-bound skill API the surface hands to this page. */
  readonly api: QaBoundSkillApi;
}

type QaSkillsView =
  | { readonly kind: "catalog" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly name: string };

/**
 * Personal skills: the catalog, and the editor for one skill or a new one.
 *
 * The page owns the server state (list, tools, loaded document, in-flight
 * failures) and hands the editor a draft only once a document has loaded, so
 * a save always carries the revision it read. Creating and editing share one
 * route: the difference is whether a loaded document exists to compare with.
 */
export function QaSkillsSettingsPage(props: QaSkillsSettingsPageProps) {
  const { api } = props;
  const [view, setView] = useState<QaSkillsView>({ kind: "catalog" });
  const [skills, setSkills] = useState<readonly QaSkillSummary[]>([]);
  const [tools, setTools] = useState<readonly QaSkillToolDescriptor[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [document, setDocument] = useState<QaSkillDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<QaSkillDraftInput | null>(null);
  const [validation, setValidation] =
    useState<QaSkillValidationState>(NO_VALIDATION);

  const loadTools = useCallback(async () => {
    const result = await api.tools();
    if (!result.ok) {
      setToolsError(skillFailureCopy(result.error));
      return;
    }
    setTools([...result.value]);
    setToolsError(null);
  }, [api]);

  const loadList = useCallback(async () => {
    setLoading(true);
    const result = await api.list();
    setLoading(false);
    if (!result.ok) {
      setListError(skillFailureCopy(result.error));
      return;
    }
    setSkills([...result.value]);
    setListError(null);
  }, [api]);

  const loadDocument = useCallback(
    async (name: string) => {
      setDocumentLoading(true);
      const result = await api.get(name);
      setDocumentLoading(false);
      if (!result.ok) {
        setEditorError(skillFailureCopy(result.error));
        setView({ kind: "catalog" });
        void loadList();
        return;
      }
      setDocument(result.value);
      setEditorError(null);
      setConflict(false);
    },
    [api, loadList],
  );

  useEffect(() => {
    void loadList();
    void loadTools();
  }, [loadList, loadTools]);

  // The editor reports every draft; the Host is asked once typing settles, and
  // a late answer for a superseded draft is dropped.
  const validateRequest = useRef(0);
  const storedName = view.kind === "edit" ? view.name : null;
  const reportDraft = useCallback((input: QaSkillDraftInput) => {
    setDraft(input);
  }, []);
  useEffect(() => {
    if (draft === null) return;
    const request = validateRequest.current + 1;
    validateRequest.current = request;
    setValidation((current) => ({ ...current, pending: true }));
    const timer = setTimeout(() => {
      void api.validate(storedName, draft).then((result) => {
        if (request !== validateRequest.current) return;
        if (!result.ok) {
          setValidation({ preview: "", diagnostics: [], pending: false });
          return;
        }
        setValidation({
          preview: result.value.preview,
          diagnostics: result.value.diagnostics,
          pending: false,
        });
      });
    }, VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, draft, storedName]);

  const openSkill = (name: string) => {
    setDocument(null);
    setDraft(null);
    setValidation(NO_VALIDATION);
    setEditorError(null);
    setView({ kind: "edit", name });
    void loadDocument(name);
  };
  const save = async (name: string | null, input: QaSkillDraftInput) => {
    setSaving(true);
    const result =
      name === null ? await api.create(input) : await api.update(name, input);
    setSaving(false);
    if (!result.ok) {
      setEditorError(skillFailureCopy(result.error));
      setConflict(isSkillConflict(result.error));
      return;
    }
    setDocument(result.value);
    setEditorError(null);
    setConflict(false);
    setView({ kind: "edit", name: result.value.name });
    void loadList();
  };
  const remove = async (name: string, revision: string | null) => {
    const result = await api.remove(name, revision);
    if (!result.ok) {
      setEditorError(skillFailureCopy(result.error));
      return;
    }
    setDocument(null);
    setEditorError(null);
    setView({ kind: "catalog" });
    void loadList();
  };

  if (view.kind === "catalog") {
    return (
      <QaSkillCatalog
        skills={skills}
        loading={loading}
        error={listError}
        onOpen={openSkill}
        onCreate={() => {
          setDocument(null);
          setDraft(null);
          setValidation(NO_VALIDATION);
          setEditorError(null);
          setConflict(false);
          setView({ kind: "create" });
        }}
        onReload={() => {
          void loadList();
          void loadTools();
        }}
      />
    );
  }
  if (view.kind === "edit" && documentLoading) {
    return <p className="dsh-qa-settings__field-hint">Загрузка навыка…</p>;
  }
  return (
    <QaSkillEditor
      key={view.kind === "edit" ? view.name : "create"}
      mode={view.kind === "edit" ? "edit" : "create"}
      document={document}
      validation={validation}
      onDraftChange={reportDraft}
      tools={tools}
      toolsError={toolsError}
      saving={saving}
      error={editorError}
      conflict={conflict}
      onBack={() => {
        setDocument(null);
        setDraft(null);
        setValidation(NO_VALIDATION);
        setEditorError(null);
        setView({ kind: "catalog" });
        void loadList();
      }}
      onSave={(input) =>
        void save(
          view.kind === "edit" ? (document?.name ?? view.name) : null,
          input,
        )
      }
      onDelete={() => {
        if (document === null) return;
        void remove(document.name, document.revision);
      }}
      onReload={() => {
        if (view.kind !== "edit") return;
        void loadDocument(document?.name ?? view.name);
      }}
    />
  );
}
