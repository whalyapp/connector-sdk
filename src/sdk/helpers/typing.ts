
interface TypeDef {
    anyOf?: TypeDef[]
    type: string | string[]
    format?: "date-time"
}
/**
 * Return True if JSON Schema type definition is a 'date-time' type.
 * 
 * Also returns True if 'date-time' is nested within an 'anyOf' type Array.

 * @param typeDef 
 * @returns 
 */
export const isDatetimeType = (typeDef: TypeDef): boolean => {

    if (!typeDef) {
        throw new Error("Could not detect type from empty typeDef param.")
    }

    if (typeDef["anyOf"] !== undefined) {
        for (const subTypeDef of typeDef["anyOf"]) {
            if (isDatetimeType(subTypeDef)) {
                return true
            }
        }
        return false
    }

    else if (typeDef["type"] !== undefined) {
        return typeDef["format"] === "date-time"
    }

    throw new Error(
        `Could not detect type of key using schema '${typeDef}'`
    )

}