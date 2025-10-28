// https://cloud.google.com/bigquery/docs/schemas#column_names
export const safeColumnName = (key: string): string => {

    let returnString = key;
    // Remove unsupported prefix
    const shouldNotStartWith = ["_TABLE_", "_FILE_", "_PARTITION"]
    shouldNotStartWith.forEach(snm => {
        if (returnString.startsWith(snm)) {
            returnString = returnString.replace(snm, "")
        }
    })

    // remove begining numeric characters
    returnString = returnString.replace(/^[-\d\s]*/g, "")

    // Go in lowercase
    returnString = returnString.toLowerCase()

    // Remove ticks
    returnString = returnString.replace('`', '')

    // Remove accents in a nice way
    returnString = returnString.normalize("NFD").replace(/[\u0300-\u036f]/g, "")

    // Trim to first 300 characters
    if (returnString.length > 300) {
        returnString = returnString.substr(0, 300);
    }

    // Remove non alphabetic characters
    const pattern = /[^a-zA-Z0-9_]/gm
    return returnString.replace(pattern, '_');
}

// https://cloud.google.com/bigquery/docs/tables#table_naming
export const safeTableName = (key: string) => {

    let returnString = key;

    // Go in lowercase
    returnString = returnString.toLowerCase()

    // Remove ticks
    returnString = returnString.replace('`', '')

    // Remove accents in a nice way
    returnString = returnString.normalize("NFD").replace(/[\u0300-\u036f]/g, "")

    // Trim to first 300 characters
    if (returnString.length > 1024) {
        returnString = returnString.substr(0, 1024);
    }

    // Remove non alphabetic characters
    const pattern = /[^a-zA-Z0-9_]/gm
    return returnString.replace(pattern, '_');
}