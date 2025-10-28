import { appendFile } from "fs-extra";
import { TargetSchemaHook, TargetSchemaHookInput } from "../../../sdk/models/target/targetHook";

export class LocalSchemaHook implements TargetSchemaHook {
    async writeSchema(input: TargetSchemaHookInput): Promise<void> {
        await appendFile("./schema.tmp", JSON.stringify(input) + '\n')
    }
}