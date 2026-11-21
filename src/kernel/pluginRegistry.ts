import type {
    Plugin,
    Id,
    PluginKind,
    EventBus,
    CredentialVault
} from "./contracts";

export class PluginRegistry {

    private plugins = new Map<Id, Plugin>();

    private enabled = new Set<Id>();

    private vaults = new Map<Id, CredentialVault>();

    constructor(private readonly events: EventBus) {}

    register(plugin: unknown): void {

        // 1. Check that plugin is an object
        if (
            typeof plugin !== "object" ||
            plugin === null ||
            Array.isArray(plugin)
        ) {
            throw new Error("Invalid plugin");
        }

        const p = plugin as Record<string, unknown>;

        // 2. Validate basic properties
        if (
            typeof p.id !== "string" ||
            p.id.trim() === "" ||
            typeof p.name !== "string" ||
            p.name.trim() === "" ||
            typeof p.version !== "string" ||
            p.version.trim() === "" ||
            !Array.isArray(p.permissions)
        ) {
            throw new Error("Invalid plugin");
        }

        // 3. Validate plugin kind
        const validKinds: PluginKind[] = [
            "methodology",
            "storage",
            "exporter",
            "diagram"
        ];

        if (!validKinds.includes(p.kind as PluginKind)) {
            throw new Error("Invalid plugin kind");
        }

        const kind = p.kind as PluginKind;

        // 4. Validate permissions
        const validPermissions = p.permissions.every(
            (permission: unknown) => {

                if (
                    typeof permission !== "object" ||
                    permission === null ||
                    Array.isArray(permission)
                ) {
                    return false;
                }

                const perm = permission as Record<string, unknown>;

                if (perm.type === "network") {
                    return typeof perm.host === "string" &&
                        perm.host.trim() !== "";
                }

                if (perm.type === "model") {
                    return perm.access === "read" ||
                        perm.access === "write";
                }

                return false;
            }
        );

        if (!validPermissions) {
            throw new Error("Invalid plugin permissions");
        }

        // 5. Validate required methods for each kind
        const requiredMethods: Record<PluginKind, string[]> = {
            methodology: ["evaluate"],
            storage: [
                "authenticate",
                "list",
                "open",
                "save",
                "getRevision"
            ],
            exporter: ["render"],
            diagram: [
                "mount",
                "unmount",
                "onChange",
                "getAccessibleView"
            ]
        };

        const methods = requiredMethods[kind];

        if (!methods.every(method => typeof p[method] === "function")) {
            throw new Error("Plugin is missing required methods");
        }

        // 6. Validate kind-specific properties
        switch (kind) {

            case "methodology":
                if (
                    !Array.isArray(p.categories) ||
                    !Array.isArray(p.rules)
                ) {
                    throw new Error("Invalid methodology plugin");
                }
                break;

            case "storage": {
                if (
                    typeof p.features !== "object" ||
                    p.features === null ||
                    Array.isArray(p.features)
                ) {
                    throw new Error("Invalid storage plugin");
                }

                const features = p.features as Record<string, unknown>;

                if (
                    typeof features.read !== "boolean" ||
                    typeof features.write !== "boolean" ||
                    typeof features.remote !== "boolean" ||
                    typeof features.requiresAuth !== "boolean"
                ) {
                    throw new Error("Invalid storage plugin");
                }
                break;
            }

            case "exporter":
                if (
                    typeof p.format !== "string" ||
                    p.format.trim() === "" ||
                    typeof p.mimeType !== "string" ||
                    p.mimeType.trim() === ""
                ) {
                    throw new Error("Invalid exporter plugin");
                }
                break;

            case "diagram":
                // Required diagram methods checked above.
                break;
        }

        // 7. Validate optional lifecycle methods
        if (
            (p.activate !== undefined &&
                typeof p.activate !== "function") ||
            (p.deactivate !== undefined &&
                typeof p.deactivate !== "function")
        ) {
            throw new Error("Invalid plugin lifecycle methods");
        }

        // 8. Check for duplicate plugin IDs
        const id = p.id as Id;

        if (this.plugins.has(id)) {
            throw new Error(`Plugin with ID ${id} already exists`);
        }

        // 9. Register the plugin
        this.plugins.set(id, plugin as Plugin);
    }

    get(id: Id): Plugin | undefined {
        return this.plugins.get(id);
    }

    getByKind(kind: PluginKind): Plugin[] {
        return Array.from(this.plugins.values())
            .filter(plugin => plugin.kind === kind);
    }

    isEnabled(id: Id): boolean {
        return this.enabled.has(id);
    }

    async enable(id: Id): Promise<void> {

        const plugin = this.plugins.get(id);

        if (plugin === undefined) {
            throw new Error(`Unknown plugin: ${id}`);
        }

        if (this.enabled.has(id)) {
            return;
        }

        let secret: string | undefined;

        const credentials: CredentialVault = {
            store(value) { secret = value; },
            get() { return secret; },
            clear() { secret = undefined; }
        };

        await plugin.activate?.({
            events: this.events,
            credentials: credentials
        });

        this.vaults.set(id, credentials);
        this.enabled.add(id);
    }

    async disable(id: Id): Promise<void> {

        const plugin = this.plugins.get(id);

        if (plugin === undefined) {
            throw new Error(`Unknown plugin: ${id}`);
        }

        if (!this.enabled.has(id)) {
            return;
        }

        await plugin.deactivate?.();

        this.vaults.get(id)?.clear();
        this.vaults.delete(id);

        this.enabled.delete(id);
    }
}