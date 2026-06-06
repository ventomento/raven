/**
 * Namespace: DomForge
 * Minimal vanilla DOM factory helpers
 */

function applyClass(el, className) {
  if (className) {
    el.className = className;
  }

  return el;
}

const DomForge = {};

// -----------------------------
// Primitive Elements
// -----------------------------

DomForge.div = function(content = null, className = null) {
  const el = document.createElement("div");

  if (content instanceof Node) {
    el.appendChild(content);
  } else if (typeof content === "string") {
    el.textContent = content;
  }

  return applyClass(el, className);
};

DomForge.span = function(text = "", className = null) {
  const el = document.createElement("span");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.p = function(text = "", className = null) {
  const el = document.createElement("p");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.label = function(text = "", className = null) {
  const el = document.createElement("label");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.h1 = function(text = "", className = null) {
  const el = document.createElement("h1");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.h2 = function(text = "", className = null) {
  const el = document.createElement("h2");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.hr = function(className) {
  const el = document.createElement("hr");
  
  return applyClass(el, className);
}

DomForge.h3 = function(text = "", className = null) {
  const el = document.createElement("h3");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.h4 = function(text = "", className = null) {
  const el = document.createElement("h4");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.h5 = function(text = "", className = null) {
  const el = document.createElement("h5");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.option = function(value = "", text = "", className = null) {
  const el = document.createElement("option");

  el.value = value;
  el.textContent = text;

  return applyClass(el, className);
};

DomForge.select = function(options = [], className = null) {
  const el = document.createElement("select");

  options.forEach(option => {
    if (option instanceof HTMLOptionElement) {
      el.appendChild(option);
    }
  });

  return applyClass(el, className);
};

DomForge.input = function(type = "text", value = "", className = null) {
  const el = document.createElement("input");

  el.type = type;
  el.value = value;

  return applyClass(el, className);
};

DomForge.textarea = function(value = "", className = null) {
  const el = document.createElement("textarea");

  el.value = value;

  return applyClass(el, className);
};

DomForge.img = function(src = "", alt = "", className = null) {
  const el = document.createElement("img");

  el.src = src;
  el.alt = alt;

  return applyClass(el, className);
};

DomForge.button = function(text = "", className = null) {
  const el = document.createElement("button");

  el.innerText = text;
  
  return applyClass(el, className);
}

// New Envelope.
DomForge.envelopeForm = function(className = null) {

  const div = DomForge.div(null, className);

  div.appendChild(DomForge.label("Recipient Hex"));
  div.appendChild(DomForge.input("text"));
  div.appendChild(DomForge.label("Message"));
  div.appendChild(DomForge.textarea());

  return div;
}

DomForge.pre = function(text = "", className = null) {
  const el = document.createElement("pre");

  el.textContent = text;

  return applyClass(el, className);
};

DomForge.error = function(error, className = null) {
  const container = DomForge.div(null, className);

  container.appendChild(DomForge.h3("Error"));

  const fields = [
    ["Name", error?.name],
    ["Message", error?.message],
    ["Stack", error?.stack]
  ];

  fields.forEach(([label, value]) => {
    const row = DomForge.div();

    row.appendChild(DomForge.span(`${label}: `));

    row.appendChild(
      DomForge.pre(
        value !== undefined && value !== null
          ? String(value)
          : ""
      )
    );

    container.appendChild(row);
  });

  return container;
};

// New relay.
DomForge.relayForm = function(className = null) {

  const div = DomForge.div(null, className);
  
  div.appendChild(DomForge.label("Relay Url"));
  div.appendChild(DomForge.input("text"));
  div.appendChild(DomForge.label("Relay Type"));
  div.appendChild(
    DomForge.select([
      DomForge.option("archive", "archive"),
      DomForge.option("ephemeral", "ephemeral"),
    ])
  )

  return div;
}

// -----------------------------
// Envelope Component
// -----------------------------

/**
 * Envelope object shape:
 * {
 *   publicKeyHex,
 *   senderPublicKeyHex,
 *   recipientPublicKeyHex,
 *   contentType,
 *   plaintext,
 *   timestamp,
 *   uuid,
 *   relayUrl,
 *   receivedAt
 * }
 */

DomForge.envelope = function(envelopeObj, className = null) {

  const container = DomForge.div(null, className);

  container.appendChild(
    DomForge.div(
      envelopeObj.direction === "inbound" ? "Peer" : "You",
      "shade" 
    )
  );
  
  container.appendChild(
    DomForge.label(
      formatUTCDate(envelopeObj.timestamp)
    )
  )

  if (envelopeObj.contentType === 1) {
    container.appendChild(
      DomForge.pre(envelopeObj.plaintext)
    )
  }

  return container;
};

// relay Component
DomForge.relay = function(relayObj, className = null) {

  const container = DomForge.div(null, className);

  const fields = [
    ["Relay URL", relayObj.relayUrl],
    ["Relay Type", relayObj.relayType],
    ["Disabled", relayObj.disabled],
    ["Cursor", relayObj.cursor],
    ["Last Success At", formatUTCDate(relayObj.lastSuccessAt)],
    ["Last Failure At", formatUTCDate(relayObj.lastFailureAt)],
    ["Failure Count", relayObj.failureCount]
  ];

  fields.forEach(([label, value]) => {
    const row = DomForge.div();

    row.appendChild(DomForge.span(`${label}: `));

    row.appendChild(
      DomForge.span(
        value !== undefined && value !== null
          ? String(value)
          : ""
      )
    );

    container.appendChild(row);
  });

  return container;
};

// -----------------------------
// Conversation Component
// -----------------------------

/**
 * Conversation object shape:
 * {
 *   publicKeyHex,
 *   unreadCount,
 *   lastMessageAt
 * }
 */

DomForge.conversation = function(conversationObj, className = null) {
  const container = DomForge.div(null, className);

  container.dataset.publicKeyHex = conversationObj.publicKeyHex;

  container.appendChild(
    DomForge.p(
      "Peer: 0x" + conversationObj.publicKeyHex
    )
  )

  container.appendChild(
    DomForge.label(
      "Unread Count: " + conversationObj.unreadCount + " | "
    )
  )

  container.appendChild(
    DomForge.label(
      "Last Message At: " + formatUTCDate(conversationObj.lastMessageAt)
    )
  )
  
  return container;
};

// -----------------------------
// List Helpers
// -----------------------------

DomForge.envelopeList = function(envelopes = [], className = null) {
  return envelopes.map(env => DomForge.envelope(env, className));
};

DomForge.conversationList = function(conversations = [], className = null) {
  return conversations.map(conv => DomForge.conversation(conv, className));
};

// util
function formatUTCDate(timestamp) {
    if (timestamp == null || timestamp === "") return "";

    const ts = Number(timestamp);

    if (!Number.isFinite(ts)) return "—";

    // Detect seconds vs milliseconds
    // Unix seconds are ~10 digits, milliseconds are ~13 digits
    const normalizedTs = ts > 1e12 ? ts : ts * 1000;

    const date = new Date(normalizedTs);

    if (isNaN(date.getTime())) return "—";

    // Format: 2026-05-28 13:45:22 UTC
    return date.toISOString()
        .replace("T", " ")
        .slice(0, 19) + " UTC";
}



// -----------------------------
// Export Namespace
// -----------------------------

export { DomForge };