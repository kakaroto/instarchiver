import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,jsx}"], plugins: { js }, extends: ["js/recommended"], rules: js.configs.recommended.rules },
  { files: ["**/*.{js,mjs,cjs,jsx}"], languageOptions: { globals: globals.node } },
]);
