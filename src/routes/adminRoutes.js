import { Router } from "express";
import {
  criarEntradaBaseConhecimento,
  obterAgendamentos,
  obterPacientes,
  retomarAtendimento,
} from "../controllers/adminController.js";
import { verificarApiKeyAdmin } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post(
  "/admin/base-conhecimento",
  adminLimiter,
  verificarApiKeyAdmin,
  asyncHandler(criarEntradaBaseConhecimento)
);

router.get(
  "/admin/agendamentos",
  adminLimiter,
  verificarApiKeyAdmin,
  asyncHandler(obterAgendamentos)
);

router.get("/admin/pacientes", adminLimiter, verificarApiKeyAdmin, asyncHandler(obterPacientes));

router.post(
  "/admin/pacientes/:id/retomar",
  adminLimiter,
  verificarApiKeyAdmin,
  asyncHandler(retomarAtendimento)
);

export default router;
