-- questionKey() no longer lumps "right to work" and "needs sponsorship" together, and the seeded
-- questions got proper keys. Move existing rows so the owner's answers stay with their question.
-- Unanswered seed rows go first (the app re-creates them), so only real answers are moved and nothing collides.
-- Order matters: the sponsorship row must leave work_authorization before anything takes that key.
DELETE FROM answer_bank WHERE answer = '' AND question_key IN (
  'work_authorization', 'visa_sponsorship', 'are_you_legally_authorized_to_work_in_this_country',
  'i_consent_to_the_processing_of_my_personal_data_for_this_application', 'data_consent',
  'what_are_your_pronouns', 'pronouns', 'linkedin_profile_url', 'linkedin', 'portfolio_or_website_url', 'website'
);
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'visa_sponsorship' WHERE question_key = 'work_authorization';
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'work_authorization' WHERE question_key = 'are_you_legally_authorized_to_work_in_this_country';
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'data_consent' WHERE question_key = 'i_consent_to_the_processing_of_my_personal_data_for_this_application';
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'pronouns' WHERE question_key = 'what_are_your_pronouns';
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'linkedin' WHERE question_key = 'linkedin_profile_url';
--> statement-breakpoint
UPDATE answer_bank SET question_key = 'website' WHERE question_key = 'portfolio_or_website_url';
--> statement-breakpoint
-- Single-user tables hold one row; the code reads them with LIMIT 1, so a second row would be picked at random.
CREATE UNIQUE INDEX profile_singleton ON profile ((true));
--> statement-breakpoint
CREATE UNIQUE INDEX preferences_singleton ON preferences ((true));
--> statement-breakpoint
DELETE FROM settings WHERE id NOT IN (SELECT id FROM settings ORDER BY created_at LIMIT 1);
--> statement-breakpoint
CREATE UNIQUE INDEX settings_singleton ON settings ((true));
