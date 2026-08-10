/**
 * Sync diário Rubeus: cursos/ofertas + amostra de etapas reais.
 * Não substitui webhooks — só catálogo e reconciliação leve.
 */
import {
  ErroRubeus,
  sincronizarCursos,
  sincronizarEtapasDeOportunidades,
} from './rubeus';

export async function reconciliarRubeus(env: Env): Promise<void> {
  if (!env.RUBEUS_ORIGEM || !env.RUBEUS_TOKEN) {
    console.log(JSON.stringify({ evento: 'rubeus_sync_pulado', motivo: 'credenciais_ausentes' }));
    return;
  }
  try {
    const cursos = await sincronizarCursos(env, env.DB);
    const etapas = await sincronizarEtapasDeOportunidades(env, env.DB, 25);
    console.log(JSON.stringify({ evento: 'rubeus_sync_ok', ...cursos, ...etapas }));
  } catch (e) {
    console.error(JSON.stringify({
      evento: 'rubeus_sync_erro',
      msg: e instanceof ErroRubeus ? e.message : String(e),
    }));
  }
}
