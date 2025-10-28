import { LocalFilesResolver } from "../../resolvers/local-file/resolver";
import { type ResolverType } from "../models/models";
import { type Resolver } from "../models/resolver";

function initResolver(resolverType: ResolverType): Resolver {
    if (resolverType === "LOCAL") {
        return new LocalFilesResolver()
    } else {
        throw new Error(`❌ Unsupported configResolver: ${resolverType}`)
    }
}

export const loadResolver = (): Resolver => {
    const configResolver = process.env.SHORE__CONFIG_RESOLVER;
    if (!configResolver) {
        throw new Error(`Env variable \`SHORE__CONFIG_RESOLVER\` is not set. 
        Did you forget to configure it?

        Possible values are \`LOCAL\`, \`WHALY\`.
        Please read the documentation to get the full description of the behavior of each.
        `)
    }
    if (configResolver === "WHALY" || configResolver === "LOCAL") {
        return initResolver(configResolver);
    } else {
        throw new Error(`Resolver: ${configResolver} is not supported.
        Did you properly configure \`SHORE__CONFIG_RESOLVER\`?`)
    }
}