import {createContext} from "react";
import type {CurrentUser} from "./api";

export const ProjectIdentity = createContext<CurrentUser | undefined>(undefined);
