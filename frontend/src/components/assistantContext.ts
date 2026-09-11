export function assistantContext() {
  const context_mode = localStorage.getItem('jobghost-context-mode') === 'custom' ? 'custom' : 'resume';
  return context_mode === 'custom'
    ? {context_mode, custom_prompt: localStorage.getItem('jobghost-custom-prompt') || '', resume_id: null}
    : {context_mode, resume_id: localStorage.getItem('jobghost-interview-resume') || null};
}

export function preparationOptions() {
  let document_ids: string[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem('jobghost-materials') || '[]');
    if (Array.isArray(value)) document_ids = value.filter((x): x is string => typeof x === 'string').slice(0, 20);
  } catch { /* Invalid local preferences are ignored. */ }
  return {document_ids, save_history: localStorage.getItem('jobghost-save-history') === 'true'};
}

export function questionContext() {
  return {...assistantContext(), ...preparationOptions(), session_id: sessionStorage.getItem('jobghost-session') || null};
}
