export const toolRegistry = [
  {
    type: "function",
    function: {
      name: "read_local_file",
      description: "Reads the content of a local file in the developer's workspace. Use this to understand the code before answering or modifying it.",
      parameters: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "The relative path to the file from the project root (e.g., 'src/app/page.tsx' or 'package.json')",
          },
        },
        required: ["filepath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "Lists files and folders inside the developer's workspace. Use this FIRST when you don't know the exact file path — e.g. to find where a component, config, or feature lives — before calling read_local_file.",
      parameters: {
        type: "object",
        properties: {
          dirpath: {
            type: "string",
            description: "Relative path of the directory to list, from the project root. Use '.' or omit for the project root.",
          },
          recursive: {
            type: "boolean",
            description: "If true, walks subdirectories too (depth-limited). Default false (top level only). node_modules, .git, .next, dist, build are always skipped.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_codebase",
      description: "Searches file contents across the workspace for a text pattern (case-insensitive substring or regex) and returns matching file:line:snippet results. Use this to find where a function, string, or symbol is defined or used, when you don't know which file to read.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Text or regular expression to search for, e.g. 'function handleSend' or 'TODO'.",
          },
          dirpath: {
            type: "string",
            description: "Optional: restrict the search to this relative subdirectory instead of the whole workspace.",
          },
          max_results: {
            type: "number",
            description: "Optional. Maximum number of matching lines to return. Default 50, max 200.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_local_file",
      description: "Creates a new file or completely OVERWRITES an existing file in the workspace with the given content. Use for a brand-new file, or when rewriting a file's entire content. For a small change to an existing file, prefer edit_local_file instead so you don't have to retype the whole file. This action will prompt the user for permission before running.",
      parameters: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "Relative path from the project root, e.g. 'src/utils/format.ts'.",
          },
          content: {
            type: "string",
            description: "The COMPLETE file content to write (this replaces the entire file if it already exists).",
          },
        },
        required: ["filepath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_local_file",
      description: "Makes a targeted edit to an existing file by replacing one exact occurrence of old_string with new_string, without retyping the rest of the file. old_string MUST match the file's current content exactly (including whitespace/indentation) and MUST be unique in the file unless replace_all is set. Always read_local_file first if you're not certain of the exact current content. This action will prompt the user for permission before running.",
      parameters: {
        type: "object",
        properties: {
          filepath: {
            type: "string",
            description: "Relative path from the project root of the file to edit.",
          },
          old_string: {
            type: "string",
            description: "The exact text to find and replace. Must match the file content exactly, including indentation.",
          },
          new_string: {
            type: "string",
            description: "The replacement text (use an empty string to delete old_string).",
          },
          replace_all: {
            type: "boolean",
            description: "If true, replaces every occurrence of old_string instead of requiring it to be unique. Default false.",
          },
        },
        required: ["filepath", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_terminal_command",
      description: "Executes a shell command in the local terminal and CAPTURES THE OUTPUT (STDOUT/STDERR) to return it to you. Use this single tool for ALL terminal needs: Git operations (git status, diff, commit), Package managers (npm, pip), Linters, Test Runners, and File execution. This action will prompt the user for permission.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The exact shell command to execute in the Windows terminal.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_website",
      description: "Scrapes a URL and returns its text content formatted as Markdown. Use this to read documentation, github issues, or tutorials from the web.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL of the website to scrape (e.g., 'https://react.dev/reference/react')",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Searches the internet for current information, news, facts, documentation, or websites. Use this when the user asks about general knowledge that might be recent or requires browsing without providing a specific URL.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (e.g., 'Next.js 15 release notes', 'current world cup winner')"
          },
          max_results: {
            type: "number",
            description: "Optional. Maximum number of search results to return. Default is 5."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "introspect_database",
      description: "Reads the schema of a local SQLite or PostgreSQL database. Use this to understand the data structure before writing SQL queries.",
      parameters: {
        type: "object",
        properties: {
          dbType: {
            type: "string",
            enum: ["sqlite", "postgres"],
            description: "The type of the database.",
          },
          connectionString: {
            type: "string",
            description: "For SQLite, the relative file path (e.g., 'prisma/dev.db'). For Postgres, the connection URL.",
          }
        },
        required: ["dbType", "connectionString"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_presentation",
      description: "Generates a real PowerPoint (.pptx) file saved locally to the workspace/output/ directory. Use this when the user asks to create a presentation.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The filename (e.g., 'Presentation.pptx')" },
          slides: {
            type: "array",
            description: "Array of slide objects.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Slide title" },
                body: { type: "string", description: "Optional main text" },
                bullets: { type: "array", items: { type: "string" }, description: "Optional bullet points" },
                notes: { type: "string", description: "Optional speaker notes" }
              },
              required: ["title"]
            }
          }
        },
        required: ["filename", "slides"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_excel_file",
      description: "Generates a real Excel (.xlsx) file saved locally to the workspace/output/ directory. Use this when the user explicitly wants a file created, otherwise use render_spreadsheet for UI visualization.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The filename (e.g., 'Data.xlsx')" },
          data: {
            type: "array",
            description: "Array of JSON objects representing the rows (flat keys to string/number).",
            items: { type: "object" }
          }
        },
        required: ["filename", "data"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_word_doc",
      description: "Generates a real Word (.docx) file saved locally to the workspace/output/ directory. Uses basic markdown conversion.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The filename (e.g., 'Document.docx')" },
          content: { type: "string", description: "The markdown content to convert to Word." }
        },
        required: ["filename", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_preference",
      description: "Saves a user coding preference or rule to long-term memory. Use this when the user says 'remember to...', 'always use...', 'never do...', or states a preference.",
      parameters: {
        type: "object",
        properties: {
          rule: {
            type: "string",
            description: "The specific rule to remember (e.g., 'Always use Tailwind CSS for styling', 'Never use var, always use let/const').",
          },
        },
        required: ["rule"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_code_editor",
      description: "Opens a dedicated Code Editor Canvas in the UI for the user. Use this when generating a complete file, a large refactor (>50 lines), or complex code modules.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The name of the file being edited/created (e.g., 'App.tsx')" },
          language: { type: "string", description: "The programming language for syntax highlighting (e.g., 'typescript', 'python')" },
          code_content: { type: "string", description: "The complete raw code content to render in the editor." }
        },
        required: ["filename", "language", "code_content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_live_preview",
      description: "Opens a Live Web Preview Canvas in the UI. Use this when the user asks to build a web component, landing page, or interactive UI. You MUST provide the FULL HTML containing all CSS and JS inside it.",
      parameters: {
        type: "object",
        properties: {
          html_content: { 
            type: "string", 
            description: "The complete, standalone HTML document including <html>, <style>, and <script> tags to render in the live preview iframe." 
          }
        },
        required: ["html_content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_rich_document",
      description: "Opens a Rich Document Canvas in the UI. Use this when the user asks to write a long article, report, PRD, technical documentation, meeting notes, or any structured long-form content. ALWAYS use this instead of writing a long markdown response in the chat.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the document (e.g., 'API Documentation', 'Project PRD')" },
          content: { type: "string", description: "The full document content in standard Markdown format. Use headings (#, ##), lists, bold, code blocks, etc." }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draw_diagram",
      description: "Opens a Diagram Canvas in the UI using Mermaid.js syntax. Use this for ANY conceptual diagram: flowchart, sequence diagram, ERD, class diagram, state diagram, mindmap, gantt, timeline, pie (conceptual), gitgraph, quadrant chart, user journey, C4 context, USE CASE diagram, VENN diagram, component diagram, activity diagram. DO NOT use for bar/line charts with numeric data — use create_graphic_canvas for those.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the diagram (e.g., 'Use Case Sistem Login', 'ERD Toko Online')" },
          code: {
            type: "string",
            description: "REQUIRED: Complete valid Mermaid.js diagram code. MUST NOT be empty. Do NOT wrap in backticks. Examples by type:\n- Use Case: 'graph TD\\n  User((User)) --> UC1[Login]'\n- Venn: 'graph LR\\n  subgraph A[Only A]\\n    A1[x]\\n  end\\n  subgraph B[Both]\\n    B1[y]\\n  end\\n  A --- B'\n- Flowchart: 'flowchart TD\\n  A[Start] --> B{Check}\\n  B -- Yes --> C[Done]'\n- ERD: 'erDiagram\\n  USER { int id PK\\n  string name }'\n- Sequence: 'sequenceDiagram\\n  User->>Server: Login'\n- Mindmap: 'mindmap\\n  root(Topic)\\n    Branch1'\n- Timeline: 'timeline\\n  2020 : Event'\n- Quadrant: 'quadrantChart\\n  x-axis Low --> High\\n  y-axis Low --> High\\n  Item: [0.5, 0.5]'"
          }
        },
        required: ["title", "code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "render_spreadsheet",
      description: "Opens a downloadable interactive Spreadsheet Canvas in the UI. Call this tool whenever the user asks for: tabular data, a table, data produk, data penjualan, data karyawan, Excel file, CSV file, spreadsheet, or any structured list of data. ALWAYS use this instead of writing a Markdown table in chat. The user can download the result as CSV/Excel directly from the canvas. Generate ALL rows completely with real data.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the spreadsheet (e.g., 'Data Produk Sederhana', 'Data Penjualan Q1 2024')" },
          data: {
            type: "string",
            description: "A valid JSON array of objects where each object is one row. Keys are column headers. ALL values must be strings. Generate complete realistic data — do NOT leave rows empty. Example for product data: '[{\"ID\":\"P001\",\"Nama Produk\":\"Laptop Gaming\",\"Kategori\":\"Elektronik\",\"Harga\":\"8500000\",\"Stok\":\"15\"},{\"ID\":\"P002\",\"Nama Produk\":\"Smartphone\",\"Kategori\":\"Elektronik\",\"Harga\":\"3200000\",\"Stok\":\"45\"}]'"
          }
        },
        required: ["title", "data"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_graphic_canvas",
      description: "Opens an interactive Chart Canvas to visualize NUMERIC DATA as a chart. Use ONLY when the user wants to plot actual numbers: bar chart, line chart, pie chart, scatter, radar, doughnut. NEVER use this for conceptual diagrams (flowchart, ERD, use case, venn, mindmap) — use draw_diagram for those. NEVER use for simple tables — use Markdown tables for those.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The chart title (e.g., 'Perbandingan Kecepatan Framework', 'Penjualan Q3 2024')" },
          chart_type: {
            type: "string",
            enum: ["bar", "line", "pie", "doughnut", "radar", "scatter", "polarArea"],
            description: "The chart type to render."
          },
          labels: {
            type: "string",
            description: "JSON array of label strings for each data point. Example: '[\"React\",\"Vue\",\"Angular\"]'"
          },
          datasets: {
            type: "string",
            description: "JSON array of dataset objects. Each dataset has: label (string), data (number[]). Example: '[{\"label\":\"Stars (k)\",\"data\":[220,206,90]}]'"
          }
        },
        required: ["title", "chart_type", "labels", "datasets"]
      }
    }
  },
];
