#!/usr/bin/env bun

import { fileURLToPath } from "url"
import path from "path"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

import { $ } from "bun"
import fs from "fs"

import { createClient } from "@hey-api/openapi-ts"

await $`bun dev generate > ${path.join(dir, "openapi.json")}`.cwd(path.resolve(dir, "../../kreonyx"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
if (fs.existsSync(path.join(dir, "dist"))) {
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true })
}
await $`bun tsc`
fs.unlinkSync(path.join(dir, "openapi.json"))
