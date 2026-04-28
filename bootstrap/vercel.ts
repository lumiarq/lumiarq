import appPromise from "@/bootstrap/entry"
import { createVercelAdapter } from "@illumiarq/adapters/vercel"

export const config = { runtime: "nodejs" }
export default createVercelAdapter(appPromise)
