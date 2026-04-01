/**
 * スコープ解決・可視範囲・祖先チェーン
 */

/**
 * スコープに応じた project_name / workspace_name のバリデーション
 */
export function validateScope(scope, projectName, workspaceName) {
  switch (scope) {
    case 'global':
      return { project_name: '', workspace_name: '' };
    case 'project':
      if (!projectName) throw new Error('project スコープには --project が必要です。');
      return { project_name: projectName, workspace_name: '' };
    case 'workspace':
      if (!projectName) throw new Error('workspace スコープには --project が必要です。');
      if (!workspaceName) throw new Error('workspace スコープには --workspace が必要です。');
      return { project_name: projectName, workspace_name: workspaceName };
    default:
      throw new Error(`不正なスコープ: ${scope}`);
  }
}

/**
 * ワークスペースの存在確認
 */
export function workspaceExists(db, projectName, workspaceName) {
  return !!db.prepare(
    'SELECT 1 FROM workspaces WHERE project_name = ? AND workspace_name = ?'
  ).get(projectName, workspaceName);
}

/**
 * 可視範囲のコンテキストを取得するための WHERE 条件を構築
 * scope=all の場合: global + 当該 project + 当該 workspace（他プロジェクトは除外）
 */
export function buildScopeFilter(scope, projectName, workspaceName, includeArchived = false, tableAlias = 'contexts') {
  const conditions = [];
  const params = [];
  const t = tableAlias;

  if (scope === 'all') {
    // global
    conditions.push(`(${t}.scope = 'global')`);
    if (projectName) {
      // project
      conditions.push(`(${t}.scope = 'project' AND ${t}.project_name = ?)`);
      params.push(projectName);
      if (workspaceName) {
        // 特定ワークスペース
        conditions.push(`(${t}.scope = 'workspace' AND ${t}.project_name = ? AND ${t}.workspace_name = ?)`);
        params.push(projectName, workspaceName);
      } else {
        // プロジェクト配下の全ワークスペース
        conditions.push(`(${t}.scope = 'workspace' AND ${t}.project_name = ?)`);
        params.push(projectName);
      }
    }
  } else {
    conditions.push(`(${t}.scope = ? AND ${t}.project_name = ? AND ${t}.workspace_name = ?)`);
    const validated = validateScope(scope, projectName, workspaceName);
    params.push(scope, validated.project_name, validated.workspace_name);
  }

  let sql = '(' + conditions.join(' OR ') + ')';

  // archived ワークスペースの除外
  if (!includeArchived) {
    sql += ` AND NOT (${t}.scope = 'workspace' AND EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.project_name = ${t}.project_name
        AND w.workspace_name = ${t}.workspace_name
        AND w.status = 'archived'
    ))`;
  }

  return { sql, params };
}

