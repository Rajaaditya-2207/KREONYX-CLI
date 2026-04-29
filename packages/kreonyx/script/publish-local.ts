#!/usr/bin/env bun
/**
 * publish-local.ts — Windows-compatible publish script for KREONYX CLI
 *
 * Usage:
 *   1. Build first:     bun run script/build.ts
 *   2. Then publish:    bun run script/publish-local.ts
 *
 * Environment variables:
 *   OPENCODE_VERSION  — Override version (default: reads from Script)
 *   NPM_TAG           — npm dist-tag (default: "latest")
 *   DRY_RUN           — Set to "1" to do a dry run (no actual publish)
 */

import fs from "fs"
import path from "path"
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@kreonyx/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const dryRun = process.env.DRY_RUN === "1"
const npmTag = process.env.NPM_TAG || Script.channel || "latest"

// ── Step 1: Discover built binaries ──────────────────────────────────────────
console.log("\n📦 Discovering built platform binaries...\n")

const binaries: Record<string, string> = {}
const distDir = path.join(dir, "dist")

if (!fs.existsSync(distDir)) {
    console.error("❌ dist/ directory not found. Run the build first:")
    console.error("   bun run script/build.ts")
    process.exit(1)
}

for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgJsonPath = path.join(distDir, entry.name, "package.json")
    if (!fs.existsSync(pkgJsonPath)) continue
    const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
    if (pkgData.name && pkgData.version) {
        binaries[pkgData.name] = pkgData.version
        console.log(`  ✅ Found: ${pkgData.name}@${pkgData.version}`)
    }
}

if (Object.keys(binaries).length === 0) {
    console.error("❌ No platform binaries found in dist/. Run the build first.")
    process.exit(1)
}

const version = Object.values(binaries)[0]
console.log(`\n📋 Version: ${version}`)
console.log(`📋 Tag: ${npmTag}`)
console.log(`📋 Packages: ${Object.keys(binaries).length} platform(s)\n`)

// ── Step 2: Create main wrapper package ──────────────────────────────────────
console.log("📁 Creating main kreonyx-ai wrapper package...\n")

const mainPkgDir = path.join(distDir, pkg.name)
fs.mkdirSync(mainPkgDir, { recursive: true })

// Copy bin directory
const binSrcDir = path.join(dir, "bin")
const binDestDir = path.join(mainPkgDir, "bin")
fs.mkdirSync(binDestDir, { recursive: true })
for (const file of fs.readdirSync(binSrcDir)) {
    fs.copyFileSync(path.join(binSrcDir, file), path.join(binDestDir, file))
}

// Copy postinstall script
const postinstallSrc = path.join(dir, "script", "postinstall.mjs")
if (fs.existsSync(postinstallSrc)) {
    fs.copyFileSync(postinstallSrc, path.join(mainPkgDir, "postinstall.mjs"))
}

// Copy LICENSE
const licenseSrc = path.join(dir, "..", "..", "LICENSE")
if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(mainPkgDir, "LICENSE"))
}

// Create README
fs.writeFileSync(
    path.join(mainPkgDir, "README.md"),
    [
        "# KREONYX CLI",
        "",
        "AI-powered development tool for the terminal.",
        "",
        "## Installation",
        "",
        "```bash",
        "npm install -g kreonyx-ai",
        "```",
        "",
        "## Usage",
        "",
        "```bash",
        "kreonyx",
        "```",
        "",
        `## Version ${version}`,
        "",
        "Built with ❤️ by KREONYX",
        "",
    ].join("\n"),
)

// Write main package.json
const mainPkgJson = {
    name: pkg.name + "-ai",
    description: "AI-powered development tool for the terminal",
    bin: {
        [pkg.name]: `./bin/${pkg.name}`,
    },
    scripts: {
        postinstall: "node ./postinstall.mjs || true",
    },
    version,
    license: pkg.license,
    repository: {
        type: "git",
        url: "https://github.com/Rajaaditya-2207/KREONYX-CLI.git",
    },
    keywords: ["ai", "cli", "coding", "terminal", "kreonyx", "development"],
    optionalDependencies: binaries,
}

fs.writeFileSync(path.join(mainPkgDir, "package.json"), JSON.stringify(mainPkgJson, null, 2))
console.log(`  ✅ Main package: ${mainPkgJson.name}@${version}`)
console.log(`  ✅ optionalDependencies:`)
for (const [name, ver] of Object.entries(binaries)) {
    console.log(`       ${name}@${ver}`)
}

// ── Step 3: Publish platform binary packages ─────────────────────────────────
console.log("\n🚀 Publishing platform binary packages...\n")

const publishArgs = dryRun ? ["--dry-run"] : []

for (const [name] of Object.entries(binaries)) {
    const pkgDir = path.join(distDir, name)
    console.log(`  Publishing ${name}...`)
    try {
        await $`npm pack`.cwd(pkgDir)
        await $`npm publish *.tgz --access public --tag ${npmTag} ${publishArgs}`.cwd(pkgDir)
        console.log(`  ✅ ${name} published!`)
    } catch (e: any) {
        console.error(`  ❌ Failed to publish ${name}: ${e.message}`)
        process.exit(1)
    }
}

// ── Step 4: Publish main wrapper package ─────────────────────────────────────
console.log("\n🚀 Publishing main kreonyx-ai package...\n")

try {
    await $`npm pack`.cwd(mainPkgDir)
    await $`npm publish *.tgz --access public --tag ${npmTag} ${publishArgs}`.cwd(mainPkgDir)
    console.log(`  ✅ ${mainPkgJson.name}@${version} published!`)
} catch (e: any) {
    console.error(`  ❌ Failed to publish main package: ${e.message}`)
    process.exit(1)
}

// ── Done ─────────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(60))
console.log("🎉 KREONYX CLI published successfully!")
console.log("═".repeat(60))
console.log(`\n  Install on any machine with:`)
console.log(`  ${dryRun ? "(DRY RUN — not actually published)" : ""}`)
console.log(`\n    npm install -g kreonyx-ai\n`)
console.log(`  Then run:`)
console.log(`\n    kreonyx\n`)
