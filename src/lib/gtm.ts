/**
 * Instalação da tag de captura direto no Google Tag Manager.
 *
 * O caminho manual — copiar o `<script>`, abrir o GTM, criar uma tag de HTML
 * personalizado, escolher o acionamento, salvar — tem cinco passos e quatro
 * lugares de errar. O mais caro deles é silencioso: escolher o acionamento
 * errado faz a tag existir, o painel parecer instalado e nenhum clique chegar.
 *
 * Esta biblioteca faz os cinco passos pela API e para antes do último. **Não
 * publica o contêiner** — cria a tag no workspace padrão e devolve o link. A
 * publicação continua sendo um ato humano, no GTM, porque ela vale para o site
 * inteiro e não só para o que este painel mexeu: um `submit` de contêiner leva
 * junto qualquer rascunho que outra pessoa tenha deixado ali.
 */

import { ErroGoogle, obterAccessToken } from './google';

const GTM = 'https://tagmanager.googleapis.com/tagmanager/v2';

export class ErroGtm extends ErroGoogle {}

async function chamar<T>(
  env: Env,
  caminho: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const token = await obterAccessToken(env);
  const resp = await fetch(`${GTM}${caminho}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'gtm_erro', caminho, status: resp.status, corpo: texto.slice(0, 400),
    }));
    /*
     * O 403 aqui quase sempre é escopo, não permissão de conta.
     *
     * O consentimento antigo desta conta não cobre `tagmanager.*`, e a mensagem
     * crua do Google ("Request had insufficient authentication scopes") manda
     * procurar no lugar errado — parece acesso negado ao contêiner.
     */
    if (resp.status === 403 && texto.includes('scope')) {
      throw new ErroGtm(
        'a credencial do Google não tem permissão de Tag Manager — refaça o consentimento local e republique o secret',
        403,
      );
    }
    let msg = `Tag Manager respondeu ${resp.status}`;
    try {
      msg = JSON.parse(texto)?.error?.message || msg;
    } catch { /* corpo não-JSON */ }
    throw new ErroGtm(msg, resp.status === 403 ? 403 : 502);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

export type ContainerGtm = {
  /** `accounts/123/containers/456` — é assim que a API endereça tudo. */
  path: string;
  nome: string;
  conta: string;
  /** `GTM-XXXX`, que é como a pessoa reconhece o contêiner. */
  publicId: string;
};

/**
 * Os contêineres que a conta conectada enxerga.
 *
 * Duas chamadas por conta, e uma conta costuma ter poucos contêineres — mas o
 * `Promise.all` evita que dez contas virem dez idas em série numa tela que a
 * pessoa está olhando.
 */
export async function listarContainers(env: Env): Promise<ContainerGtm[]> {
  const { account = [] } = await chamar<{ account?: Array<{ path: string; name: string }> }>(
    env, '/accounts',
  );

  const porConta = await Promise.all(account.map(async (c) => {
    const r = await chamar<{ container?: Array<{ path: string; name: string; publicId: string; usageContext?: string[] }> }>(
      env, `/${c.path}/containers`,
    );
    return (r.container ?? [])
      /*
       * Só contêiner web.
       *
       * Um contêiner de AMP, iOS ou Android aceitaria a tag de HTML
       * personalizado e ela nunca rodaria — a captura depende de `document` e
       * de formulário HTML. Melhor não oferecer do que oferecer e falhar depois.
       */
      .filter((ct) => !ct.usageContext?.length || ct.usageContext.includes('web'))
      .map((ct) => ({ path: ct.path, nome: ct.name, conta: c.name, publicId: ct.publicId }));
  }));

  return porConta.flat();
}

/**
 * O workspace padrão do contêiner.
 *
 * O GTM cria um "Default Workspace" em todo contêiner, e é onde quem mexe à mão
 * trabalha. Instalar ali — e não num workspace novo — é o que faz a tag aparecer
 * para a pessoa no lugar em que ela já ia olhar, junto das outras mudanças
 * pendentes, na mesma revisão que ela vai publicar.
 *
 * Quando o nome foi trocado, cai no de menor id, que é o mais antigo — o padrão
 * renomeado, na prática.
 */
async function workspacePadrao(env: Env, containerPath: string): Promise<string> {
  const { workspace = [] } = await chamar<{ workspace?: Array<{ path: string; name: string; workspaceId: string }> }>(
    env, `/${containerPath}/workspaces`,
  );
  if (!workspace.length) throw new ErroGtm('o contêiner não tem workspace', 502);

  const padrao = workspace.find((w) => w.name === 'Default Workspace')
    ?? [...workspace].sort((a, b) => Number(a.workspaceId) - Number(b.workspaceId))[0]!;
  return padrao.path;
}

/**
 * O acionamento de todas as páginas: reaproveita um, ou cria.
 *
 * O GTM tem um "All Pages" embutido cujo id é uma constante conhecida
 * (`2147479553`), e usá-la seria mais curto. Não usamos: constante mágica de
 * outra ferramenta é a espécie de detalhe que muda sem avisar e falha longe de
 * onde foi escrita. Procurar um gatilho de `pageview` e criar quando não houver
 * dá o mesmo resultado e continua verdadeiro se o id mudar.
 */
async function gatilhoTodasAsPaginas(env: Env, workspacePath: string): Promise<string> {
  const { trigger = [] } = await chamar<{ trigger?: Array<{ triggerId: string; type: string; name: string }> }>(
    env, `/${workspacePath}/triggers`,
  );

  const existente = trigger.find((t) => t.type === 'pageview');
  if (existente) return existente.triggerId;

  const criado = await chamar<{ triggerId: string }>(env, `/${workspacePath}/triggers`, {
    method: 'POST',
    body: { name: 'All Pages — captura Faculdade IDE', type: 'pageview' },
  });
  return criado.triggerId;
}

export type ResultadoInstalacao = {
  criada: boolean;
  tagId: string;
  nome: string;
  /** Link direto para a tag no GTM, para conferir antes de publicar. */
  url: string | null;
  workspace: string;
};

const NOME_DA_TAG = 'Faculdade IDE — captura de click id';

/**
 * Cria (ou atualiza) a tag de captura no workspace padrão.
 *
 * Idempotente pelo nome: rodar duas vezes não gera duas tags. O GTM não impede
 * nomes repetidos, e duas tags iguais disparando na mesma página mandariam a
 * captura em dobro — o `INSERT OR IGNORE` da tabela de cliques aguentaria, mas
 * o contêiner ficaria com uma cópia órfã que ninguém sabe se pode apagar.
 */
export async function instalarTag(
  env: Env,
  containerPath: string,
  scriptUrl: string,
): Promise<ResultadoInstalacao> {
  const ws = await workspacePadrao(env, containerPath);
  const gatilho = await gatilhoTodasAsPaginas(env, ws);

  const corpo = {
    name: NOME_DA_TAG,
    type: 'html',
    parameter: [
      {
        type: 'TEMPLATE',
        key: 'html',
        value: `<script src="${scriptUrl}" async></script>`,
      },
      /*
       * `document.write` desligado: a tag entra com `async`, e o GTM injeta
       * depois do parse. Deixar ligado faria o GTM avisar do risco de reescrever
       * a página em navegação lenta, por uma capacidade que este script não usa.
       */
      { type: 'BOOLEAN', key: 'supportDocumentWrite', value: 'false' },
    ],
    firingTriggerId: [gatilho],
    notes:
      'Criada pelo painel da Faculdade IDE. Captura gclid/gbraid/wbraid da URL do anúncio e '
      + 'envia com e-mail/telefone quando um formulário é enviado. Não publica sozinha — '
      + 'a publicação do contêiner é manual.',
  };

  const { tag = [] } = await chamar<{ tag?: Array<{ tagId: string; name: string; path: string }> }>(
    env, `/${ws}/tags`,
  );
  const jaExiste = tag.find((t) => t.name === NOME_DA_TAG);

  /*
   * `PUT` no caminho da tag para atualizar, `POST` na coleção para criar — é a
   * distinção da própria API. Um `POST` no caminho de uma tag existente não
   * atualiza: devolve 404, porque ali não há coleção para receber item novo.
   */
  const salva = await chamar<{ tagId: string; name: string; tagManagerUrl?: string }>(
    env,
    jaExiste ? `/${jaExiste.path}` : `/${ws}/tags`,
    { method: jaExiste ? 'PUT' : 'POST', body: corpo },
  );

  console.log(JSON.stringify({
    evento: 'gtm_tag_instalada',
    workspace: ws,
    tag_id: salva.tagId,
    atualizada: Boolean(jaExiste),
  }));

  return {
    criada: !jaExiste,
    tagId: salva.tagId,
    nome: salva.name,
    url: salva.tagManagerUrl ?? null,
    workspace: ws,
  };
}
