import { Router } from "express";
import { receberWebhook } from "../controllers/webhookController.js";
import { verificarSegredoWebhook } from "../middleware/auth.js";
import { webhookLimiter } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// O segredo na URL (configurado como parte do endereço do webhook na
// Evolution API) garante que só a própria Evolution API consegue chamar
// essa rota — ver src/middleware/auth.js.
router.post(
  "/webhook/:secret",
  webhookLimiter,
  verificarSegredoWebhook,
  asyncHandler(receberWebhook)
);

export default router;
