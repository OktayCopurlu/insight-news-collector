// ESLint flat config for Node ESM project
import js from "@eslint/js";
import globals from "globals";
import importPlugin from "eslint-plugin-import";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: [
      "node_modules/**",
      "migrations/**",
      "llm-logs/**",
      "rss-logs/**",
      "supabase/**",
      "tests/fixtures/**",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      // Enable Node 18+ globals (process, Buffer, URL, setTimeout, AbortController, etc.)
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-undef": "error",
      // Detect unused exported members across files (accounting for test usage)
      "import/no-unused-modules": [
        "error",
        {
          unusedExports: true,
          // Treat src, scripts, and tests as source files to resolve usages
          src: [
            "./src/**/*.js",
            "./scripts/**/*.js",
            "./tests/**/*.js",
            "./index.js",
          ],
          // Ignore files that are purely executable/entry points
          ignoreExports: [
            "**/index.js",
            "create-tables.js",
            "manual-setup.js",
            "setup-database.js",
            "scripts/**",
            // Allow utilities verified only in tests
            "src/utils/helpers.js",
            // Allow service invoked via scripts and reset pipeline
            "src/services/articlePretranslator.js",
          ],
        },
      ],
    },
  },
  // Test files: enable Jest globals so describe/test/expect are recognized
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      // Tests don't export modules; keep import/no-unused-modules off here
      "import/no-unused-modules": "off",
    },
  },
];
