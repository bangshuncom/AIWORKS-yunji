import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'src-tauri/**', 'public/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      // 不用 react-hooks 的 recommended 预设：它附带的 set-state-in-effect / static-components / refs
      // 是 React Compiler 的规范建议，存量命中 32 处且都不是缺陷，会把下面这条淹掉
      // 依赖数组写漏是 TS 抓不到的，也是这个项目最容易出问题的地方
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
