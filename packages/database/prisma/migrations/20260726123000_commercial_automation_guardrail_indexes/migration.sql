CREATE INDEX "WhatsAppDispatch_status_sentAt_idx"
ON "WhatsAppDispatch"("status", "sentAt");

CREATE INDEX "WhatsAppDispatch_destinationId_status_sentAt_idx"
ON "WhatsAppDispatch"("destinationId", "status", "sentAt");

CREATE INDEX "CommercialPipelineRun_finalStatus_idx"
ON "CommercialPipelineRun"("finalStatus");

CREATE INDEX "CommercialPipelineRun_investigationRequired_idx"
ON "CommercialPipelineRun"("investigationRequired");
