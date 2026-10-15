"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, LogOut, Plus, Users, X } from "lucide-react";
import { ProfilePhotoEditor } from "@/components/profile/profile-photo-editor";
import { ContactAvatar } from "./contact-avatar";
import {
  createGroup,
  changeGroup,
  uploadGroupPhoto,
  removeGroupPhoto,
  userFacingError,
} from "@/lib/messaging/api-client";
import { maxGroupMembers, normalizeGroupName } from "@/lib/messaging/groups";
import type { ConversationSummary } from "@/lib/messaging/people";

export function CreateGroupButton({
  onCreated,
  disabled = false,
}: {
  onCreated: (conversation: ConversationSummary) => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
    const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validName = normalizeGroupName(name);
    const people = [
      ...new Set(
        emails
          .split(/[,;\s]+/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (!validName || people.length < 1 || people.length >= maxGroupMembers) {
      setError(`Choose a name and add up to ${maxGroupMembers - 1} other people by email.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const group = await createGroup(validName, people);
      dialog.current?.close();
      setName("");
      setEmails("");
      onCreated(group);
    } catch (error) {
      setError(userFacingError(error, "We couldn’t create this group. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="feature-button new-group-button"
        disabled={disabled}
        type="button"
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        <Users size={17} aria-hidden="true" />
        New group
      </button>
      <dialog
        ref={dialog}
        className="group-dialog"
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <header>
          <div>
            <p className="messaging-kicker">Better together</p>
            <h2 id={`${id}-title`}>Create a group</h2>
          </div>
          <button
            className="feature-button"
            aria-label="Close new group"
            disabled={busy}
            type="button"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={(event) => void create(event)}>
          <label htmlFor={`${id}-name`}>Group name</label>
          <input
            autoComplete="off"
            id={`${id}-name`}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A name for your people"
            required
            disabled={busy}
          />
          <label htmlFor={`${id}-emails`}>People to add</label>
          <textarea
            id={`${id}-emails`}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="friend@example.com"
            rows={3}
            required
            disabled={busy}
            aria-describedby={`${id}-hint`}
          />
          <p id={`${id}-hint`}>
            Use account emails, separated by commas or new lines. Up to {maxGroupMembers} people,
            including you. Everyone needs approved access to Untold.
          </p>
          <p>You can add a group photo and change members in Details after creating the group.</p>
          {error ? (
            <p className="messaging-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="feature-button" type="submit" disabled={busy}>
            <Plus size={17} aria-hidden="true" />
            {busy ? "Creating…" : "Create group"}
          </button>
        </form>
      </dialog>
    </>
  );
}

export function GroupSettings({
  conversation,
  viewerId,
  onChanged,
  onRefresh,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  onChanged: (conversation: ConversationSummary | null) => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(conversation.groupName ?? "");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState(conversation.groupImage ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const owner = conversation.groupOwnerId === viewerId;
  useEffect(() => setName(conversation.groupName ?? ""), [conversation.groupName]);
  useEffect(() => setImage(conversation.groupImage ?? null), [conversation.groupImage]);
  async function change(action: Parameters<typeof changeGroup>[1]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onChanged(await changeGroup(conversation.id, action));
      setEmail("");
    } catch (error) {
      setError(userFacingError(error, "We couldn’t update this group. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="group-settings" aria-label="Group settings">
      {owner ? (
        <fieldset disabled={busy} className="group-settings__owner">
          <legend>Group details</legend>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change({ action: "rename", name });
            }}
          >
            <label htmlFor={`${id}-name`}>Group name</label>
            <div className="group-settings__input-row">
              <input
                id={`${id}-name`}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button
                className="feature-button"
                disabled={name.trim() === conversation.groupName}
                type="submit"
              >
                <Check size={16} aria-hidden="true" />
                Save
              </button>
            </div>
          </form>
          <ProfilePhotoEditor
            hasPhoto={Boolean(image)}
            image={image}
            onUpload={(photo, signal) => uploadGroupPhoto(conversation.id, photo, signal)}
            onRemove={() => removeGroupPhoto(conversation.id)}
            onChange={(next) => {
              setImage(next);
              onRefresh();
            }}
          />
          {conversation.members.length < maxGroupMembers ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void change({ action: "add", email });
              }}
            >
              <label htmlFor={`${id}-email`}>Add a member</label>
              <div className="group-settings__input-row">
                <input
                  id={`${id}-email`}
                  type="email"
                  value={email}
                  maxLength={254}
                  required
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Account email"
                />
                <button className="feature-button" type="submit">
                  <Plus size={16} aria-hidden="true" />
                  Add
                </button>
              </div>
              <p className="profile-photo-editor__hint">
                New members receive messages sent after they join.
              </p>
            </form>
          ) : null}
        </fieldset>
      ) : null}
      <h4>
        Members · {conversation.members.length}/{maxGroupMembers}
      </h4>
      <ul className="group-members">
        {conversation.members.map((member) => (
          <li key={member.id}>
            <ContactAvatar person={member} />
            <span>
              <strong>
                {member.name}
                {member.id === viewerId ? " (you)" : ""}
              </strong>
              <small>
                {member.id === conversation.groupOwnerId ? "Group owner" : member.email}
              </small>
            </span>
            {owner && member.id !== viewerId ? (
              <details className="group-member-actions">
                <summary>Manage</summary>
                <div>
                  <button
                    className="feature-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Make ${member.name} the group owner? You’ll become a regular member.`,
                        )
                      )
                        void change({ action: "transfer", userId: member.id });
                    }}
                  >
                    Make owner
                  </button>
                  <button
                    className="feature-button feature-button--danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${member.name} from this group? They won’t receive future messages. Copies they already have will remain.`,
                        )
                      )
                        void change({ action: "remove", userId: member.id });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="messaging-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="feature-button feature-button--danger"
        disabled={busy}
        type="button"
        onClick={() => {
          if (
            window.confirm(
              owner && conversation.members.length > 1
                ? "Leave this group? Another member will become the owner."
                : "Leave this group? You’ll stop receiving its messages.",
            )
          )
            void change({ action: "leave" });
        }}
      >
        <LogOut size={16} aria-hidden="true" />
        Leave group
      </button>
    </section>
  );
}
