import Decimal from "decimal.js";
import dayjs from "dayjs";
import { defaultDateTimeFormat } from "../../../sdk/constants/date";
import { FlattenedSchema } from "../../../sdk/models/target/models";
import { logger } from "../../../sdk/service/logger";

//TODO: Check that the date-time are in the BigQuery limits
// Eg. From 0001-01-01 00:00:00 to 9999-12-31 23:59:59.999999
export const validateDateRange = (record: any, schema: FlattenedSchema): any => {

    Object.keys(schema).forEach(key => {
        const { format } = schema[key];

        if (format === "date-time") {
            if (record[key]) {
                const formattedDate = dayjs(record[key]).format(defaultDateTimeFormat);
                // sometimes we have dayjs that cannot convert a value that seemed appropriate previously so we need to skip it
                // ie: in the tap we had as an output from dayjs "20222-07-01T00:00:00.000000+00:00"
                // and reading it back in the target gives "Invalid date"

                // we also need to check it the date is greater that the limit in order to avoid chaos
                const isNotTooMuchInTheFuture = dayjs(record[key]).isBefore(dayjs("9999-12-31 23:59:59.999999"));
                const isNotTooMuchInThePast = dayjs(record[key]).isAfter(dayjs("0001-01-01 00:00:00"))
                if (formattedDate !== "Invalid date" && isNotTooMuchInTheFuture && isNotTooMuchInThePast) {
                    record[key] = formattedDate
                } else {
                    record[key] = undefined;
                    logger.info("Skipping date for key %s for being invalid", key)
                }
            }
        }

    })

    return record;
}

export const maxBQNumericValue = new Decimal("9.9999999999999999999999999999999999999E+28");

export const convertNumberIntoDecimal = (record: any, schema: FlattenedSchema) => {
    Object.keys(record).forEach(key => {

        if (schema[key]) {
            const { type, items } = schema[key];
            const types = type instanceof Array ? type : [type];

            if (types.includes("number")) {
                if (typeof record[key] === 'number' || record[key] instanceof Decimal) {
                    const decimal = new Decimal(record[key]).toDecimalPlaces(9);
                    if (decimal.greaterThanOrEqualTo(maxBQNumericValue)) {
                        record[key] = null;
                    } else {
                        record[key] = decimal;
                    }
                } else {
                    record[key] = null;
                }
            } else if(types.includes("array") && items?.type.includes("number")) {
                if (Array.isArray(record[key])) {
                    const rawArr = record[key];
                    const newArr = rawArr.map((item: any) => {
                        if(typeof item === 'number' || item instanceof Decimal) {
                            const parsed = new Decimal(item).toDecimalPlaces(9);
                            if (parsed.greaterThanOrEqualTo(maxBQNumericValue)) {
                                return undefined
                            } else {
                                return parsed;
                            }
                        } else {
                            return undefined;
                        }
                    }).filter((item: any) => !!item);
                    record[key] = newArr;
                } else {
                    record[key] = null;
                }
            }
        }
    })

    return record;
}