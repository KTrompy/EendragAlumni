-- ============================================================
-- Update 64: remove the in-app chat. Messaging is now a one-shot email sent
-- by the send-contact-email Edge Function (nothing is stored).
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- PERMANENT: every existing conversation and message is deleted. There is no
-- backup inside the database.
--
-- Run it AFTER the new site (the version without the chat) is live: the old
-- site reads these tables and would show errors once they are gone.
--
-- What goes:
--   * tables: message_reactions, messages, conversation_participants,
--     conversations (their policies, indexes and triggers go with them)
--   * functions: get_or_create_conversation, edit_message, delete_message,
--     mark_conversation_read, unread_message_count,
--     last_messages_for_conversations, notify_new_message, is_participant
--   * "someone sent you a message" notifications already in the bell
--   * notification_preferences.notify_message (the toggle no longer exists)
--
-- What stays, and changes meaning:
--   * profiles.privacy_messages is now "Who can email you through the site?"
--     (all | hide). send-contact-email refuses to relay an email to anyone who
--     chose hide. The retired 'mentoring' value (only people you mentor could
--     message you) is treated as hide, which is how it already behaved in
--     practice, and the constraint now allows only all/hide.
--
-- All one transaction: if anything fails, nothing changes.

begin;

delete from public.notifications
 where type = 'message' or entity_type = 'conversation';

-- Dependants first: reactions and messages reference conversations.
drop table if exists public.message_reactions cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversation_participants cascade;
drop table if exists public.conversations cascade;

drop function if exists public.notify_new_message();
drop function if exists public.get_or_create_conversation(uuid);
drop function if exists public.edit_message(bigint, text);
drop function if exists public.delete_message(bigint);
drop function if exists public.mark_conversation_read(bigint);
drop function if exists public.unread_message_count();
drop function if exists public.last_messages_for_conversations(bigint[]);
drop function if exists public.is_participant(bigint, uuid);

alter table public.notification_preferences drop column if exists notify_message;

-- "Who can email you through the site?" is now all | hide.
update public.profiles set privacy_messages = 'hide'
 where privacy_messages is distinct from 'all' and privacy_messages is distinct from 'hide';
alter table public.profiles drop constraint if exists profiles_privacy_messages_check;
alter table public.profiles
  add constraint profiles_privacy_messages_check check (privacy_messages in ('all', 'hide'));

commit;


-- ---------- CHECK ----------
-- Every number should be 0.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('messages', 'conversations', 'conversation_participants', 'message_reactions')) as chat_tables,
  (select count(*) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('notify_new_message', 'get_or_create_conversation', 'edit_message', 'delete_message',
                      'mark_conversation_read', 'unread_message_count', 'last_messages_for_conversations',
                      'is_participant'))                                                                  as chat_functions,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_preferences'
      and column_name = 'notify_message')                                                                  as chat_pref_columns,
  (select count(*) from public.notifications
    where type = 'message' or entity_type = 'conversation')                                               as chat_notifications;
