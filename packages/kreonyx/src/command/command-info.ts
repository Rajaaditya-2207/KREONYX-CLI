import z from "zod"

export const CommandInfo = z
    .object({
        name: z.string(),
        description: z.string().optional(),
        agent: z.string().optional(),
        model: z.string().optional(),
        source: z.enum(["command", "mcp", "skill"]).optional(),
        // workaround for zod not supporting async functions natively so we use getters
        // https://zod.dev/v4/changelog?id=zfunction
        template: z.promise(z.string()).or(z.string()),
        subtask: z.boolean().optional(),
        hints: z.array(z.string()),
    })
    .meta({
        ref: "Command",
    })

// for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
export type CommandInfo = Omit<z.infer<typeof CommandInfo>, "template"> & { template: Promise<string> | string }

export function commandHints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
        for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
}
