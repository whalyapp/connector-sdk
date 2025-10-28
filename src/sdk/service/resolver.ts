import { LocalFilesResolver } from "../../resolvers/local-file/resolver";
import { type Resolver } from "../models/resolver";

export const loadResolver = (): Resolver => {
   return new LocalFilesResolver()
}