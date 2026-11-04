// Regras do Desempenho: o padrão e as opções que a tela mostra e o main aceita (main e renderer usam o mesmo).

/** Minutos que cada regra aceita. Containers contam o tempo ocioso; as outras, o tempo do gatilho. */
export const MINUTES = /** @type {const} */ ({ orphans: [2, 5, 10, 15], alert: [2, 5, 10, 15], containers: [15, 30, 60] });
export const TRIGGERS = /** @type {const} */ (['critical', 'warn', 'swap']);

/**
 * Regras e protegidos que chegam da tela ou do arquivo salvo: só valores das listas fechadas; o que faltar ou vier
 * errado fica como estava. Aceita pedaços (só `auto`, só uma regra).
 * @param {any} next @param {import('../types.js').PerfPrefs} cur @returns {import('../types.js').PerfPrefs}
 */
export function perfPrefs(next, cur) {
  const rules = { ...cur.rules };
  for (const id of /** @type {const} */ (['orphans', 'containers', 'alert'])) {
    const r = next?.rules?.[id];
    if (!r || typeof r !== 'object') continue;
    const was = cur.rules[id];
    rules[id] = {
      on: typeof r.on === 'boolean' ? r.on : was.on,
      mode: id !== 'alert' && (r.mode === 'notify' || r.mode === 'act') ? r.mode : was.mode,
      trigger: /** @type {readonly unknown[]} */ (TRIGGERS).includes(r.trigger) ? r.trigger : was.trigger,
      minutes: /** @type {readonly unknown[]} */ (MINUTES[id]).includes(r.minutes) ? r.minutes : was.minutes,
    };
  }
  const list = Array.isArray(next?.protected) && next.protected.length <= 100
    ? [...new Set(next.protected.filter((/** @type {unknown} */ x) => typeof x === 'string' && x.trim()).map((/** @type {string} */ x) => x.trim().slice(0, 80)))]
    : cur.protected;
  return { auto: typeof next?.auto === 'boolean' ? next.auto : cur.auto, rules, protected: /** @type {string[]} */ (list) };
}

/** Tudo desligado: automação é escolha da pessoa. Protegidos: editor, terminal, agentes e o Docker. @returns {import('../types.js').PerfPrefs} */
export const perfDefaults = () => ({
  auto: true,
  rules: {
    orphans: { on: false, mode: 'notify', trigger: 'critical', minutes: 5 },
    containers: { on: false, mode: 'notify', trigger: 'critical', minutes: 30 },
    alert: { on: false, mode: 'notify', trigger: 'critical', minutes: 2 },
  },
  protected: ['Terminal', 'iTerm2', 'Warp', 'Ghostty', 'Visual Studio Code', 'Cursor', 'Zed', 'Xcode', 'Claude', 'codex', 'Docker'],
});
