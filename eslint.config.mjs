import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import typescript from "typescript-eslint";

export default typescript.config(
  {
    ignores: [".output/**", ".wxt/**", "node_modules/**", "reports/**"],
  },
  eslint.configs.recommended,
  ...typescript.configs.recommended,
  prettier,
);
