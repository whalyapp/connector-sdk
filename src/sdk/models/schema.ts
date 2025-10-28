export interface PropertiesMetadata {
        [propName: string]: {
                label: string,
                description?: string
        }
}

export interface Schema {
        "jsonSchema": {
                "type": "object",
                "properties": any
        },
        "propertiesMetadata"?: PropertiesMetadata
}