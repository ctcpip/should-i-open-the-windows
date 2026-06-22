import ultraMegaConfig from 'eslint-config-ultra-mega';

export default [
  ...ultraMegaConfig,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        process: 'readonly',
      },
    },
  },
];
