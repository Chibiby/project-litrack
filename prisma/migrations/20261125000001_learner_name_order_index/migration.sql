-- Additive: one b-tree index for the cross-school learner lists, which page
-- in lastName, firstName, id order with no school filter.
CREATE INDEX "Learner_lastName_firstName_id_idx" ON "Learner"("lastName", "firstName", "id");
