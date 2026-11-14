// ---------- Supabase setup ----------
const SUPABASE_URL = "https://wrokqokkvfqwseejycog.supabase.co";
const SUPABASE_KEY = "sb_publishable_NCHpkcN3yuZE3AoPvgftxw_fZucBhBj";

// `supabase` is the global from the CDN script; our client is named `db`.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

// Tiny DOM builder. Children are appended as text nodes, so user content is never parsed as HTML.
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
}

function setMsg(id, text, kind = "") {
    const node = $(id);
    node.textContent = text || "";
    node.className = "msg" + (kind ? " " + kind : "");
}

const fmtDate = (iso) => new Date(iso).toLocaleString();

const PROFANITY_MSG = "Please keep it clean: profanity isn't allowed.";

function friendlyError(error) {
    if (/profanity/i.test(error.message)) return PROFANITY_MSG;
    if (error.code === "23505") return "That already exists.";
    return error.message;
}

// ---------- Profanity filter ----------
// The word list lives in the `banned_words` table (edit it in the Supabase dashboard).
// This client check gives instant feedback; database triggers enforce the same rule.
const LEET = { "@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "!": "i" };
let bannedRegex = null;

async function loadBannedWords() {
    const { data, error } = await db.from("banned_words").select("word");
    if (error || !data?.length) {
        bannedRegex = null;
        return;
    }
    const words = data.map((r) => r.word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    bannedRegex = new RegExp("\\b(?:" + words.join("|") + ")(?:s|es|ed|ing|y)?\\b", "i");
}

function hasProfanity(...texts) {
    if (!bannedRegex) return false;
    return texts.some((t) => {
        const lower = (t || "").toLowerCase();
        const leet = lower.replace(/[@$01345!]/g, (c) => LEET[c]);
        return bannedRegex.test(lower) || bannedRegex.test(leet);
    });
}

// ---------- State ----------
let user = null;
let profile = null;
let currentForum = null;
let lastUserId; // undefined until the first auth event

// ---------- Tabs ----------
const tabButtons = document.querySelectorAll(".tab-button");
const tabContents = document.querySelectorAll(".tab-content");

function showTab(tab) {
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    tabContents.forEach((c) => { c.hidden = c.id !== tab; });
    if (tab === "forums" && !currentForum) loadForums();
}

tabButtons.forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
});

// ---------- Auth ----------
db.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    const id = user?.id ?? null;
    if (id === lastUserId) return; // ignore token refreshes
    lastUserId = id;
    // Don't await Supabase calls inside this callback; defer them.
    setTimeout(refreshSession, 0);
});

async function refreshSession() {
    profile = null;
    if (user) {
        const { data } = await db
            .from("profiles")
            .select("id, username")
            .eq("id", user.id)
            .maybeSingle();
        profile = data;
    }
    renderAccount();
    updateForumControls();
    if (currentForum) loadPosts(true);
    else if (!$("forums").hidden) loadForums();
}

function renderAccount() {
    const body = $("account-body");
    const status = $("session-status");
    body.replaceChildren();
    setMsg("account-msg", "");
    status.classList.toggle("online", !!user);

    if (user) {
        const name = profile?.username ?? user.email;
        status.textContent = "Signed in as " + name;

        body.append(
            el("div", { class: "card" },
                el("h3", {}, name),
                el("p", { class: "meta" }, user.email),
                el("div", { class: "row" },
                    el("button", {
                        type: "button",
                        class: "small-btn ghost",
                        onclick: async () => {
                            const { error } = await db.auth.signOut();
                            if (error) setMsg("account-msg", error.message, "error");
                        },
                    }, "Sign out")
                )
            )
        );
        return;
    }

    status.textContent = "Not signed in";

    const email = el("input", { type: "email", placeholder: "Email", autocomplete: "email", required: "" });
    const password = el("input", { type: "password", placeholder: "Password (min 6 chars)", autocomplete: "current-password", required: "", minlength: "6" });
    const username = el("input", { type: "text", placeholder: "Username (for new accounts)", maxlength: "30", autocomplete: "username" });

    const form = el("form", { class: "card" },
        el("h3", {}, "Sign in or create an account"),
        email, password, username,
        el("div", { class: "row" },
            el("button", { type: "submit" }, "Sign in"),
            el("button", { type: "button", id: "signup-btn" }, "Create account")
        )
    );

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        setMsg("account-msg", "Signing in...");
        const { error } = await db.auth.signInWithPassword({
            email: email.value.trim(),
            password: password.value,
        });
        if (error) setMsg("account-msg", error.message, "error");
        else setMsg("account-msg", "");
    });

    form.querySelector("#signup-btn").addEventListener("click", async () => {
        const name = username.value.trim();
        if (!email.value.trim() || password.value.length < 6) {
            return setMsg("account-msg", "Enter an email and a password of at least 6 characters.", "error");
        }
        if (name.length < 2 || name.length > 30) {
            return setMsg("account-msg", "Pick a username between 2 and 30 characters.", "error");
        }
        if (hasProfanity(name)) {
            return setMsg("account-msg", PROFANITY_MSG, "error");
        }
        setMsg("account-msg", "Creating account...");
        const { data, error } = await db.auth.signUp({
            email: email.value.trim(),
            password: password.value,
            options: { data: { username: name } },
        });
        if (error) return setMsg("account-msg", error.message, "error");
        if (!data.session) {
            setMsg("account-msg", "Account created. Check your email to confirm, then sign in.", "ok");
        }
    });

    body.append(form);
}

// ---------- Forums ----------
function updateForumControls() {
    const signedIn = !!user;
    $("new-forum-form").hidden = !signedIn;
    $("forum-login-note").hidden = signedIn;
    $("new-post-form").hidden = !signedIn;
    $("post-login-note").hidden = signedIn;
    $("delete-forum").hidden = !(signedIn && currentForum && currentForum.created_by === user.id);
}

async function loadForums() {
    const list = $("forum-list");
    setMsg("forums-msg", "");
    list.replaceChildren(el("p", { class: "empty" }, "Loading..."));

    const { data, error } = await db
        .from("forums")
        .select("id, name, description, created_by, created_at, profiles(username)")
        .order("created_at", { ascending: false });

    if (error) {
        list.replaceChildren();
        return setMsg("forums-msg", error.message, "error");
    }
    if (!data.length) {
        list.replaceChildren(el("p", { class: "empty" }, "No forums yet. Create the first one!"));
        return;
    }

    list.replaceChildren(...data.map((forum) =>
        el("div", { class: "card" },
            el("h3", {}, forum.name),
            forum.description ? el("p", { class: "body" }, forum.description) : "",
            el("p", { class: "meta" },
                `by ${forum.profiles?.username ?? "unknown"} · ${fmtDate(forum.created_at)}`),
            el("div", { class: "row" },
                el("button", { type: "button", class: "small-btn", onclick: () => openForum(forum) }, "Open")
            )
        )
    ));
}

$("new-forum-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user) return;
    const name = $("forum-name").value.trim();
    const description = $("forum-desc").value.trim();
    if (!name) return;

    if (hasProfanity(name, description)) {
        return setMsg("forums-msg", PROFANITY_MSG, "error");
    }

    setMsg("forums-msg", "Creating...");
    const { error } = await db.from("forums").insert({ name, description, created_by: user.id });
    if (error) {
        const dup = error.code === "23505";
        return setMsg("forums-msg", dup ? "A forum with that name already exists." : friendlyError(error), "error");
    }
    $("new-forum-form").reset();
    setMsg("forums-msg", "Forum created.", "ok");
    loadForums();
});

function openForum(forum) {
    currentForum = forum;
    $("forums-list-view").hidden = true;
    $("forum-view").hidden = false;
    $("forum-title").textContent = forum.name;
    $("forum-description").textContent = forum.description || "";
    setMsg("posts-msg", "");
    updateForumControls();
    loadPosts();
}

$("back-to-forums").addEventListener("click", () => {
    currentForum = null;
    $("forum-view").hidden = true;
    $("forums-list-view").hidden = false;
    loadForums();
});

$("delete-forum").addEventListener("click", async () => {
    if (!currentForum) return;
    if (!confirm(`Delete "${currentForum.name}" and all its posts?`)) return;
    const { error } = await db.from("forums").delete().eq("id", currentForum.id);
    if (error) return setMsg("posts-msg", friendlyError(error), "error");
    $("back-to-forums").click();
});

// ---------- Posts ----------
async function loadPosts(quiet = false) {
    if (!currentForum) return;
    const forumId = currentForum.id;
    const list = $("post-list");

    if (!quiet) {
        setMsg("posts-msg", "");
        list.replaceChildren(el("p", { class: "empty" }, "Loading..."));
    }

    const { data: posts, error } = await db
        .from("posts")
        .select("id, title, body, author_id, created_at, profiles(username)")
        .eq("forum_id", forumId)
        .order("created_at", { ascending: false });

    if (currentForum?.id !== forumId) return; // user navigated away while loading
    if (error) {
        list.replaceChildren();
        return setMsg("posts-msg", error.message, "error");
    }
    if (!posts.length) {
        list.replaceChildren(el("p", { class: "empty" }, "No posts yet."));
        return;
    }

    // One query for every reply in this forum, grouped by post.
    const { data: replies, error: replyError } = await db
        .from("replies")
        .select("id, post_id, parent_id, body, author_id, created_at, profiles(username)")
        .in("post_id", posts.map((p) => p.id))
        .order("created_at", { ascending: true });

    if (currentForum?.id !== forumId) return;
    if (replyError) setMsg("posts-msg", replyError.message, "error");

    const byPost = new Map();
    for (const r of replies ?? []) {
        if (!byPost.has(r.post_id)) byPost.set(r.post_id, []);
        byPost.get(r.post_id).push(r);
    }

    list.replaceChildren(...posts.map((p) => renderPost(p, byPost.get(p.id) ?? [])));
}

function renderPost(post, replies) {
    const byId = new Map();
    const children = new Map(); // parent_id (null = top level) -> replies
    for (const r of replies) {
        byId.set(r.id, r);
        const key = r.parent_id ?? null;
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(r);
    }

    const formSlot = el("div", {});
    const actions = el("div", { class: "row" });

    if (user) {
        actions.append(el("button", {
            type: "button",
            class: "small-btn ghost",
            onclick: () => toggleReplyForm(formSlot, post.id, null),
        }, "Reply"));
    }
    if (user && post.author_id === user.id) {
        actions.append(el("button", {
            type: "button",
            class: "small-btn danger",
            onclick: async () => {
                if (!confirm("Delete this post and all its replies?")) return;
                const { error } = await db.from("posts").delete().eq("id", post.id);
                if (error) setMsg("posts-msg", friendlyError(error), "error");
                else loadPosts(true);
            },
        }, "Delete"));
    }

    const count = replies.length;
    const card = el("article", { class: "card post" },
        el("h3", {}, post.title),
        el("p", { class: "body" }, post.body),
        el("p", { class: "meta" },
            `${post.profiles?.username ?? "unknown"} · ${fmtDate(post.created_at)} · ${count} ${count === 1 ? "reply" : "replies"}`),
        actions,
        formSlot
    );

    if (count) card.append(renderThread(post.id, null, 0, children, byId));
    return card;
}

// ---------- Replies ----------
const MAX_DEPTH = 6; // deeper replies stop indenting so the thread stays readable

function renderThread(postId, parentId, depth, children, byId) {
    const box = el("div", { class: "replies" + (depth >= MAX_DEPTH ? " flat" : "") });
    for (const reply of children.get(parentId) ?? []) {
        box.append(renderReply(reply, postId, depth, children, byId));
    }
    return box;
}

function renderReply(reply, postId, depth, children, byId) {
    const formSlot = el("div", {});
    const actions = el("div", { class: "row" });
    const parent = reply.parent_id ? byId.get(reply.parent_id) : null;

    const meta = el("p", { class: "meta" },
        el("strong", {}, reply.profiles?.username ?? "unknown"),
        ` · ${fmtDate(reply.created_at)}`
    );
    // Once indentation stops, show who this reply is answering.
    if (parent && depth >= MAX_DEPTH) {
        meta.append(` · ↳ ${parent.profiles?.username ?? "unknown"}`);
    }

    if (user) {
        actions.append(el("button", {
            type: "button",
            class: "small-btn ghost",
            onclick: () => toggleReplyForm(formSlot, postId, reply.id),
        }, "Reply"));
    }
    if (user && reply.author_id === user.id) {
        actions.append(el("button", {
            type: "button",
            class: "small-btn danger",
            onclick: async () => {
                const hasKids = !!children.get(reply.id)?.length;
                const ask = hasKids ? "Delete this reply and everything under it?" : "Delete this reply?";
                if (!confirm(ask)) return;
                const { error } = await db.from("replies").delete().eq("id", reply.id);
                if (error) setMsg("posts-msg", friendlyError(error), "error");
                else loadPosts(true);
            },
        }, "Delete"));
    }

    const node = el("div", { class: "reply" },
        meta,
        el("p", { class: "body" }, reply.body),
        actions,
        formSlot
    );

    if (children.get(reply.id)?.length) {
        node.append(renderThread(postId, reply.id, depth + 1, children, byId));
    }
    return node;
}

function toggleReplyForm(slot, postId, parentId) {
    if (slot.firstChild) {
        slot.replaceChildren();
        return;
    }
    slot.append(buildReplyForm(postId, parentId, () => slot.replaceChildren()));
}

function buildReplyForm(postId, parentId, close) {
    const body = el("textarea", { placeholder: "Write a reply...", maxlength: "2000", rows: "3", required: "" });
    const msg = el("p", { class: "msg" });

    const form = el("form", { class: "reply-form" },
        body,
        msg,
        el("div", { class: "row" },
            el("button", { type: "submit" }, "Send"),
            el("button", { type: "button", class: "ghost", onclick: close }, "Cancel")
        )
    );

    const show = (text, kind = "") => {
        msg.textContent = text;
        msg.className = "msg" + (kind ? " " + kind : "");
    };

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = body.value.trim();
        if (!text || !user) return;

        if (hasProfanity(text)) return show(PROFANITY_MSG, "error");

        show("Sending...");
        const { error } = await db.from("replies").insert({
            post_id: postId,
            parent_id: parentId,
            author_id: user.id,
            body: text,
        });
        if (error) return show(friendlyError(error), "error");

        loadPosts(true);
    });

    setTimeout(() => body.focus(), 0);
    return form;
}

// ---------- New post ----------
$("new-post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user || !currentForum) return;
    const title = $("post-title").value.trim();
    const body = $("post-body").value.trim();
    if (!title || !body) return;

    if (hasProfanity(title, body)) {
        return setMsg("posts-msg", PROFANITY_MSG, "error");
    }

    setMsg("posts-msg", "Posting...");
    const { error } = await db.from("posts").insert({
        forum_id: currentForum.id,
        author_id: user.id,
        title,
        body,
    });
    if (error) return setMsg("posts-msg", friendlyError(error), "error");

    $("new-post-form").reset();
    setMsg("posts-msg", "");
    loadPosts(true);
});

// ---------- Init ----------
loadBannedWords();
renderAccount();
updateForumControls();