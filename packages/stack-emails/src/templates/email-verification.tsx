import { TEditorConfiguration } from "../editor/documents/editor/core";

export const emailVerificationTemplate: TEditorConfiguration = {
  "root": {
    "type": "EmailLayout",
    "data": {
      "backdropColor": "#FFFFFF",
      "canvasColor": "#FFFFFF",
      "textColor": "#242424",
      "fontFamily": "MODERN_SANS",
      "childrenIds": [
        "block_BjpQ7DGTtvaEuYRMd7VE7w",
        "block_xyg4GWmgGbJJEDRQc76bC",
        "block-1727062582681",
        "block-1727062622114",
        "block_Gtk3kDYwsJqEmQf2XGWPRc",
        "block_LACDCzUS2bsvEbmnq1KHuW"
      ]
    }
  },
  "block_xyg4GWmgGbJJEDRQc76bC": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#474849",
        "backgroundColor": null,
        "fontSize": 14,
        "fontFamily": null,
        "fontWeight": "normal",
        "textAlign": "center",
        "padding": {
          "top": 8,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "Hi{{#if userDisplayName}}, {{ userDisplayName }}{{/if}}! Welcome to {{ projectDisplayName }}. {{#if otp}}This is your one-time-password for email verification: {{/if}}"
      }
    }
  },
  "block_BjpQ7DGTtvaEuYRMd7VE7w": {
    "type": "Heading",
    "data": {
      "props": {
        "text": "Verify your email at {{ projectDisplayName }}",
        "level": "h3"
      },
      "style": {
        "color": "#000000",
        "backgroundColor": null,
        "fontFamily": null,
        "fontWeight": "bold",
        "textAlign": "center",
        "padding": {
          "top": 16,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      }
    }
  },
  "block_Gtk3kDYwsJqEmQf2XGWPRc": {
    "data": {
      "props": {
        "lineColor": "#EEEEEE",
        "lineHeight": 1
      },
      "style": {
        "padding": {
          "top": 16,
          "left": 24,
          "right": 24,
          "bottom": 16
        },
        "backgroundColor": null
      }
    },
    "type": "Divider"
  },
  "block_LACDCzUS2bsvEbmnq1KHuW": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#474849",
        "backgroundColor": null,
        "fontSize": 12,
        "fontFamily": null,
        "fontWeight": "normal",
        "textAlign": "center",
        "padding": {
          "top": 4,
          "bottom": 24,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "If you were not expecting this email, you can safely ignore it."
      }
    }
  },
  "block-1727053976677": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#000000",
        "fontSize": 36,
        "fontFamily": "MONOSPACE",
        "fontWeight": "bold",
        "textAlign": "center",
        "padding": {
          "top": 16,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "{{ otp }}"
      }
    }
  },
  "block-1727054013149": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#000000",
        "fontSize": 14,
        "fontWeight": "normal",
        "textAlign": "center",
        "padding": {
          "top": 16,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "Or you can click on [this link]({{ magicLink }}) to login"
      }
    }
  },
  "block-1727062582681": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#000000",
        "fontSize": 35,
        "fontFamily": "MONOSPACE",
        "fontWeight": "bold",
        "textAlign": "center",
        "padding": {
          "top": 16,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "{{ otp }}"
      }
    }
  },
  "block-1727062622114": {
    "type": "Text",
    "data": {
      "style": {
        "color": "#000000",
        "fontSize": 14,
        "fontWeight": "normal",
        "textAlign": "center",
        "padding": {
          "top": 16,
          "bottom": 16,
          "right": 24,
          "left": 24
        }
      },
      "props": {
        "text": "{{#if otp}}Or you can {{/if}}click on [this link]({{ magicLink }}) to verify your email"
      }
    }
  }
};
