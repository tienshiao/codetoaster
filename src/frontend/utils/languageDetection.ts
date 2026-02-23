export type CommentStyle = 'c-style' | 'hash' | 'html' | 'sql' | 'none';

export interface LanguageConfig {
  name: string;
  commentStyles: CommentStyle[];
  keywords: string[];
}

const C_STYLE_KEYWORDS = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'function', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'const', 'let', 'var', 'static', 'public', 'private', 'protected', 'readonly',
  'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'async', 'await',
  'import', 'export', 'from', 'as', 'default', 'typeof', 'instanceof', 'in', 'of',
  'void', 'null', 'undefined', 'true', 'false', 'get', 'set', 'yield',
];

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var', 'true', 'false', 'nil',
];

const RUST_KEYWORDS = [
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
  'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
  'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super',
  'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
];

const PYTHON_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import',
  'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'True', 'try', 'while', 'with', 'yield',
];

const RUBY_KEYWORDS = [
  'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do', 'else',
  'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module', 'next', 'nil', 'not',
  'or', 'redo', 'rescue', 'retry', 'return', 'self', 'super', 'then', 'true', 'undef',
  'unless', 'until', 'when', 'while', 'yield',
];

const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case',
  'esac', 'function', 'in', 'select', 'return', 'exit', 'break', 'continue', 'local',
  'export', 'readonly', 'declare', 'typeset', 'unset', 'shift', 'source', 'true', 'false',
];

const JAVA_KEYWORDS = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final',
  'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int',
  'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public',
  'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
];

// SQL keywords (uppercase for convention, matched case-insensitively)
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'CONSTRAINT', 'PRIMARY', 'KEY',
  'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'ON', 'USING',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'FETCH',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'IF', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'TO',
  'CAST', 'CONVERT', 'COALESCE', 'NULLIF', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'SAVEPOINT', 'GRANT', 'REVOKE',
  'WITH', 'RECURSIVE', 'RETURNING', 'OVER', 'PARTITION', 'ROW', 'ROWS', 'RANGE',
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'REAL',
  'DOUBLE', 'PRECISION', 'VARCHAR', 'CHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIME',
  'TIMESTAMP', 'INTERVAL', 'SERIAL', 'BIGSERIAL', 'UUID', 'JSON', 'JSONB', 'ARRAY',
];

const languages: Record<string, LanguageConfig> = {
  typescript: { name: 'TypeScript', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
  javascript: { name: 'JavaScript', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
  json: { name: 'JSON', commentStyles: ['none'], keywords: [] },
  jsonc: { name: 'JSON with Comments', commentStyles: ['c-style'], keywords: [] },
  css: { name: 'CSS', commentStyles: ['c-style'], keywords: [] },
  html: { name: 'HTML', commentStyles: ['html'], keywords: [] },
  xml: { name: 'XML', commentStyles: ['html'], keywords: [] },
  sql: { name: 'SQL', commentStyles: ['sql', 'c-style'], keywords: SQL_KEYWORDS },
  markdown: { name: 'Markdown', commentStyles: ['none'], keywords: [] },
  yaml: { name: 'YAML', commentStyles: ['hash'], keywords: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'] },
  toml: { name: 'TOML', commentStyles: ['hash'], keywords: ['true', 'false'] },
  python: { name: 'Python', commentStyles: ['hash'], keywords: PYTHON_KEYWORDS },
  ruby: { name: 'Ruby', commentStyles: ['hash'], keywords: RUBY_KEYWORDS },
  shell: { name: 'Shell', commentStyles: ['hash'], keywords: SHELL_KEYWORDS },
  go: { name: 'Go', commentStyles: ['c-style'], keywords: GO_KEYWORDS },
  rust: { name: 'Rust', commentStyles: ['c-style'], keywords: RUST_KEYWORDS },
  c: { name: 'C', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
  cpp: { name: 'C++', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
  java: { name: 'Java', commentStyles: ['c-style'], keywords: JAVA_KEYWORDS },
  php: { name: 'PHP', commentStyles: ['c-style', 'hash'], keywords: C_STYLE_KEYWORDS },
  swift: { name: 'Swift', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
  kotlin: { name: 'Kotlin', commentStyles: ['c-style'], keywords: C_STYLE_KEYWORDS },
};

const extensionMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  xsd: 'xml',
  svg: 'xml',
  plist: 'xml',
  xaml: 'xml',
  csproj: 'xml',
  fsproj: 'xml',
  vbproj: 'xml',
  vcxproj: 'xml',
  props: 'xml',
  targets: 'xml',
  nuspec: 'xml',
  resx: 'xml',
  pom: 'xml',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  java: 'java',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
};

export function getLanguageFromPath(filePath: string): LanguageConfig | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  const langKey = extensionMap[ext];
  if (!langKey) return null;

  return languages[langKey] || null;
}
