import { defineConfig, globalIgnores } from "eslint/config";

import eslint from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/", "node_modules/"]),

  eslint.configs.recommended,
  tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Warn instead of error so existing code doesn't block CI.
      // Tighten these to "error" once the warnings are cleaned up.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },

  // Must be last: turns off any rules that conflict with Prettier.
  prettier,
]);
