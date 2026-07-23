import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [{ ignores: ['dist/**', '.next/**', 'node_modules/**'] }, { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module' } }, plugins: { '@typescript-eslint': tseslint }, rules: { ...tseslint.configs.recommended.rules } }];
