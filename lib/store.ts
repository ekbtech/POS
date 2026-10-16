import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import path from "path";

export type Role = "admin" | "manager" | "cashier";
export type PaymentMethod = "Cash" | "Mpesa" | "Card";
export type MpesaPaymentStatus =
  | "initiating"
  | "pending"
  | "callback_success"
  | "callback_failed"
  | "confirmed"
  | "failed"
  | "unknown";

export type MpesaPaymentAttempt = {
  id: string;
  branch: string;
  userId: string;
  phoneNumber: string;
  amount: number;
  status: MpesaPaymentStatus;
  merchantRequestId: string | null;
  checkoutRequestId: string | null;
  resultCode: string | null;
  resultDescription: string | null;
  mpesaReceiptNumber: string | null;
  callbackAmount: number | null;
  callbackPhoneNumber: string | null;
  callbackResultCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branch: string;
};

export type Product = {
  id: number;
  name: string;
  barcode: string | null;
  category: string;
  price: number;
  stock: number;
  reorderLevel: number;
  stockCounted: boolean;
};

export type TransactionItem = {
  id: number;
  name: string;
  qty: number;
  price: number;
};

export type Transaction = {
  id: string;
  branch: string;
  registerId: string | null;
  shiftId: string | null;
  cashierName: string;
  customer: string;
  paymentMethod: PaymentMethod;
  items: TransactionItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cashTendered: number;
  changeDue: number;
  createdAt: string;
};

export type PosRegister = {
  id: string;
  branch: string;
  name: string;
  active: boolean;
  openShift: RegisterShift | null;
  lastClosedCash: number | null;
};

export type RegisterShift = {
  id: string;
  registerId: string;
  branch: string;
  registerName: string;
  openedBy: string;
  openedByName: string;
  openingCash: number;
  openedAt: string;
  expectedCash: number;
  closedBy: string | null;
  closedByName: string | null;
  closingCash: number | null;
  variance: number | null;
  closedAt: string | null;
};

export type RegisterShiftAuditEvent = {
  id: number;
  type: "opened" | "closed";
  actor: string;
  cashCount: number;
  expectedCash: number | null;
  variance: number | null;
  reason: string | null;
  createdAt: string;
};

export type PosApprovalAudit = {
  id: string;
  action: "cart_item_void" | "basket_discount";
  operatorName: string;
  approverName: string;
  reason: string;
  details: Record<string, unknown>;
  usedTransactionId: string | null;
  createdAt: string;
};

export type ProductInput = Pick<Product, "name" | "barcode" | "category" | "price">;

type ProductRow = RowDataPacket & {
  id: number;
  name: string;
  barcode: string | null;
  category: string;
  price: string | number;
  stock: number;
  reorderLevel: number;
  stockCounted: number | boolean;
};

type UserRow = RowDataPacket & {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  branch: string;
};

type TransactionRow = RowDataPacket & {
  id: string;
  branch: string;
  registerId: string | null;
  shiftId: string | null;
  cashierName: string;
  customer: string;
  paymentMethod: PaymentMethod;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  total: string | number;
  cashTendered: string | number;
  changeDue: string | number;
  createdAt: Date | string;
};

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

function databaseConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    if (!["mysql:", "mariadb:"].includes(url.protocol)) {
      throw new Error("DATABASE_URL must use the mysql:// or mariadb:// protocol.");
    }
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      connectionLimit: 10,
      timezone: "Z" as const,
      decimalNumbers: true,
    };
  }

  const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
    throw new Error(
      "Configure DATABASE_URL or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE.",
    );
  }

  return {
    host: MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    connectionLimit: 10,
    timezone: "Z" as const,
    decimalNumbers: true,
  };
}

function getPool() {
  pool ??= mysql.createPool(databaseConfig());
  return pool;
}

async function initializeSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS branches (
      name VARCHAR(120) PRIMARY KEY,
      city VARCHAR(120) NOT NULL,
      status ENUM('active') NOT NULL DEFAULT 'active'
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'manager', 'cashier') NOT NULL,
      branch VARCHAR(120) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_users_branch FOREIGN KEY (branch) REFERENCES branches(name)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token CHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_sessions_user (user_id)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      barcode VARCHAR(64) NULL,
      category VARCHAR(100) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      reorder_level INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_products_name (name),
      UNIQUE KEY uq_products_barcode (barcode),
      CONSTRAINT chk_product_price CHECK (price >= 0),
      CONSTRAINT chk_product_stock CHECK (stock >= 0),
      CONSTRAINT chk_product_reorder CHECK (reorder_level >= 0)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS branch_inventory (
      branch_name VARCHAR(120) NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      reorder_level INT NOT NULL DEFAULT 0,
      is_counted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (branch_name, product_id),
      CONSTRAINT fk_inventory_branch FOREIGN KEY (branch_name) REFERENCES branches(name),
      CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT chk_inventory_quantity CHECK (quantity >= 0),
      CONSTRAINT chk_inventory_reorder CHECK (reorder_level >= 0),
      INDEX idx_inventory_product (product_id)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      branch_name VARCHAR(120) NOT NULL,
      product_id INT NOT NULL,
      user_id VARCHAR(36) NULL,
      movement_type ENUM('opening', 'receipt', 'adjustment', 'sale') NOT NULL,
      quantity_delta INT NOT NULL,
      quantity_after INT NOT NULL,
      reason VARCHAR(240) NOT NULL,
      reference_id VARCHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_stock_movement_branch FOREIGN KEY (branch_name) REFERENCES branches(name),
      CONSTRAINT fk_stock_movement_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT fk_stock_movement_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_stock_movements_branch_date (branch_name, created_at),
      INDEX idx_stock_movements_product_date (product_id, created_at)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    INSERT IGNORE INTO branch_inventory (branch_name, product_id, quantity, reorder_level, is_counted)
    SELECT b.name, p.id, 0, 0, FALSE
    FROM branches b CROSS JOIN products p
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(36) PRIMARY KEY,
      branch VARCHAR(120) NOT NULL,
      register_id VARCHAR(36) NULL,
      shift_id VARCHAR(36) NULL,
      cashier_name VARCHAR(160) NOT NULL DEFAULT 'Legacy sale',
      customer VARCHAR(180) NOT NULL,
      payment_method ENUM('Cash', 'Mpesa', 'Card') NOT NULL,
      subtotal DECIMAL(12,2) NOT NULL,
      discount DECIMAL(12,2) NOT NULL,
      discount_approval_id VARCHAR(36) NULL,
      discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      discount_reason VARCHAR(255) NULL,
      discount_approved_by VARCHAR(36) NULL,
      tax DECIMAL(12,2) NOT NULL,
      total DECIMAL(12,2) NOT NULL,
      cash_tendered DECIMAL(12,2) NOT NULL DEFAULT 0,
      change_due DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_transactions_branch FOREIGN KEY (branch) REFERENCES branches(name),
      INDEX idx_transactions_created_at (created_at),
      INDEX idx_transactions_branch_date (branch, created_at),
      INDEX idx_transactions_shift (shift_id, payment_method)
    ) ENGINE=InnoDB
  `);
  const [productColumns] = await db.execute<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'barcode'",
  );
  if (!productColumns.length) {
    await db.query("ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL");
  }
  const [barcodeIndexes] = await db.execute<RowDataPacket[]>(
    "SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'uq_products_barcode'",
  );
  if (!barcodeIndexes.length) {
    await db.query("ALTER TABLE products ADD UNIQUE KEY uq_products_barcode (barcode)");
  }
  const [transactionColumns] = await db.execute<(RowDataPacket & { COLUMN_NAME: string })[]>(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'transactions'",
  );
  const existingTransactionColumns = new Set(transactionColumns.map((column) => column.COLUMN_NAME));
  const transactionMigrations = [
    ["cashier_name", "VARCHAR(160) NOT NULL DEFAULT 'Legacy sale'"],
    ["cash_tendered", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["change_due", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
  ] as const;
  for (const [column, definition] of transactionMigrations) {
    if (!existingTransactionColumns.has(column)) {
      await db.query(`ALTER TABLE transactions ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!existingTransactionColumns.has("register_id")) {
    await db.query("ALTER TABLE transactions ADD COLUMN register_id VARCHAR(36) NULL");
  }
  if (!existingTransactionColumns.has("shift_id")) {
    await db.query("ALTER TABLE transactions ADD COLUMN shift_id VARCHAR(36) NULL");
  }
  const transactionDiscountMigrations = [
    ["discount_approval_id", "VARCHAR(36) NULL"],
    ["discount_percent", "DECIMAL(5,2) NOT NULL DEFAULT 0"],
    ["discount_reason", "VARCHAR(255) NULL"],
    ["discount_approved_by", "VARCHAR(36) NULL"],
  ] as const;
  for (const [column, definition] of transactionDiscountMigrations) {
    if (!existingTransactionColumns.has(column)) {
      await db.query(`ALTER TABLE transactions ADD COLUMN ${column} ${definition}`);
    }
  }
  const [transactionShiftIndexes] = await db.execute<RowDataPacket[]>(
    "SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'transactions' AND index_name = 'idx_transactions_shift'",
  );
  if (!transactionShiftIndexes.length) {
    await db.query("ALTER TABLE transactions ADD INDEX idx_transactions_shift (shift_id, payment_method)");
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(36) NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(180) NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      CONSTRAINT fk_items_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
      UNIQUE KEY uq_transaction_product (transaction_id, product_id),
      INDEX idx_items_transaction (transaction_id)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      migration_key VARCHAR(120) PRIMARY KEY,
      completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS mpesa_payment_attempts (
      id VARCHAR(36) PRIMARY KEY,
      branch VARCHAR(120) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      idempotency_key VARCHAR(64) NOT NULL,
      phone_number VARCHAR(16) NOT NULL,
      amount INT UNSIGNED NOT NULL,
      status ENUM('initiating', 'pending', 'callback_success', 'callback_failed', 'confirmed', 'failed', 'unknown') NOT NULL,
      merchant_request_id VARCHAR(64) NULL UNIQUE,
      checkout_request_id VARCHAR(64) NULL UNIQUE,
      result_code VARCHAR(32) NULL,
      result_description VARCHAR(255) NULL,
      mpesa_receipt_number VARCHAR(32) NULL,
      callback_amount DECIMAL(12,2) NULL,
      callback_phone_number VARCHAR(16) NULL,
      callback_result_code VARCHAR(32) NULL,
      callback_received_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_mpesa_attempt_branch FOREIGN KEY (branch) REFERENCES branches(name),
      CONSTRAINT fk_mpesa_attempt_user FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE KEY uq_mpesa_attempt_idempotency (user_id, idempotency_key),
      INDEX idx_mpesa_attempt_branch_date (branch, created_at),
      INDEX idx_mpesa_attempt_status_date (status, created_at)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS mpesa_callback_inbox (
      checkout_request_id VARCHAR(64) PRIMARY KEY,
      merchant_request_id VARCHAR(64) NOT NULL,
      result_code VARCHAR(32) NOT NULL,
      result_description VARCHAR(255) NOT NULL,
      callback_amount DECIMAL(12,2) NULL,
      callback_phone_number VARCHAR(16) NULL,
      mpesa_receipt_number VARCHAR(32) NULL,
      received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_mpesa_callback_merchant (merchant_request_id)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_registers (
      id VARCHAR(36) PRIMARY KEY,
      branch_name VARCHAR(120) NOT NULL,
      name VARCHAR(80) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_register_branch FOREIGN KEY (branch_name) REFERENCES branches(name),
      UNIQUE KEY uq_register_branch_name (branch_name, name),
      INDEX idx_register_branch_active (branch_name, is_active)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_register_shifts (
      id VARCHAR(36) PRIMARY KEY,
      register_id VARCHAR(36) NOT NULL,
      branch_name VARCHAR(120) NOT NULL,
      status ENUM('open', 'closed') NOT NULL,
      open_register_id VARCHAR(36) GENERATED ALWAYS AS (
        CASE WHEN status = 'open' THEN register_id ELSE NULL END
      ) STORED,
      opened_by VARCHAR(36) NOT NULL,
      opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      opening_cash DECIMAL(12,2) NOT NULL,
      opening_variance DECIMAL(12,2) NOT NULL DEFAULT 0,
      opening_reason VARCHAR(255) NULL,
      handover_from_shift_id VARCHAR(36) NULL,
      closed_by VARCHAR(36) NULL,
      closed_at DATETIME(3) NULL,
      expected_cash DECIMAL(12,2) NULL,
      closing_cash DECIMAL(12,2) NULL,
      closing_variance DECIMAL(12,2) NULL,
      closing_reason VARCHAR(255) NULL,
      CONSTRAINT fk_register_shift_register FOREIGN KEY (register_id) REFERENCES pos_registers(id),
      CONSTRAINT fk_register_shift_branch FOREIGN KEY (branch_name) REFERENCES branches(name),
      CONSTRAINT fk_register_shift_opener FOREIGN KEY (opened_by) REFERENCES users(id),
      CONSTRAINT fk_register_shift_closer FOREIGN KEY (closed_by) REFERENCES users(id),
      CONSTRAINT fk_register_shift_handover FOREIGN KEY (handover_from_shift_id) REFERENCES pos_register_shifts(id),
      UNIQUE KEY uq_register_one_open_shift (open_register_id),
      INDEX idx_register_shifts_branch_date (branch_name, opened_at)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_register_shift_events (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      shift_id VARCHAR(36) NOT NULL,
      event_type ENUM('opened', 'closed') NOT NULL,
      actor_user_id VARCHAR(36) NOT NULL,
      cash_count DECIMAL(12,2) NOT NULL,
      expected_cash DECIMAL(12,2) NULL,
      variance DECIMAL(12,2) NULL,
      reason VARCHAR(255) NULL,
      previous_shift_id VARCHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_shift_event_shift FOREIGN KEY (shift_id) REFERENCES pos_register_shifts(id),
      CONSTRAINT fk_shift_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
      CONSTRAINT fk_shift_event_previous FOREIGN KEY (previous_shift_id) REFERENCES pos_register_shifts(id),
      INDEX idx_shift_event_shift_time (shift_id, created_at)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pos_manager_approvals (
      id VARCHAR(36) PRIMARY KEY,
      action_key VARCHAR(36) NOT NULL UNIQUE,
      branch_name VARCHAR(120) NOT NULL,
      register_id VARCHAR(36) NOT NULL,
      shift_id VARCHAR(36) NOT NULL,
      operator_user_id VARCHAR(36) NOT NULL,
      approver_user_id VARCHAR(36) NOT NULL,
      action_type ENUM('cart_item_void', 'basket_discount') NOT NULL,
      reason VARCHAR(255) NOT NULL,
      details JSON NOT NULL,
      used_transaction_id VARCHAR(36) NULL UNIQUE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_pos_approval_branch FOREIGN KEY (branch_name) REFERENCES branches(name),
      CONSTRAINT fk_pos_approval_register FOREIGN KEY (register_id) REFERENCES pos_registers(id),
      CONSTRAINT fk_pos_approval_shift FOREIGN KEY (shift_id) REFERENCES pos_register_shifts(id),
      CONSTRAINT fk_pos_approval_operator FOREIGN KEY (operator_user_id) REFERENCES users(id),
      CONSTRAINT fk_pos_approval_approver FOREIGN KEY (approver_user_id) REFERENCES users(id),
      INDEX idx_pos_approval_register_date (register_id, created_at),
      INDEX idx_pos_approval_shift (shift_id, created_at)
    ) ENGINE=InnoDB
  `);

  const branches = [
    ["Nairobi CBD", "Nairobi"],
    ["Westlands", "Nairobi"],
    ["Mombasa", "Mombasa"],
    ["Kisumu", "Kisumu"],
  ];
  for (const [name, city] of branches) {
    await db.execute(
      "INSERT IGNORE INTO branches (name, city) VALUES (?, ?)",
      [name, city],
    );
  }
  for (const [name] of branches) {
    const registerId = randomUUID();
    await db.execute(
      "INSERT IGNORE INTO pos_registers (id, branch_name, name) VALUES (?, ?, 'Register 1')",
      [registerId, name],
    );
  }

  if (process.env.POS_IMPORT_LEGACY_JSON === "1") {
    await importLegacyJson(db);
  }

  const [productCount] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM products",
  );
  if (Number(productCount[0].count) === 0) {
    const seedProducts = [
      ["Premium Rice 5kg", "Groceries", 850, 42, 30],
      ["Cooking Oil 2L", "Groceries", 520, 18, 25],
      ["Biscuits Family Pack", "Snacks", 280, 27, 20],
      ["Battery AA 4 Pack", "Household", 640, 15, 20],
      ["Laundry Detergent", "Household", 490, 24, 20],
      ["Orange Juice 1L", "Beverages", 240, 36, 25],
    ];
    await db.query(
      "INSERT INTO products (name, category, price, stock, reorder_level) VALUES ?",
      [seedProducts],
    );
  }
  await db.query(`
    INSERT IGNORE INTO branch_inventory (branch_name, product_id, quantity, reorder_level, is_counted)
    SELECT b.name, p.id, 0, 0, FALSE
    FROM branches b CROSS JOIN products p
  `);

  const adminEmail = process.env.POS_ADMIN_EMAIL || "admin@checonex.co.ke";
  const adminPassword = process.env.POS_ADMIN_PASSWORD;
  if (adminPassword) {
    if (Buffer.byteLength(adminPassword, "utf8") < 12 || Buffer.byteLength(adminPassword, "utf8") > 72) {
      throw new Error("POS_ADMIN_PASSWORD must be between 12 and 72 UTF-8 bytes.");
    }
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const [admins] = await db.execute<RowDataPacket[]>(
      "SELECT id, role FROM users WHERE email = ?",
      [adminEmail],
    );
    if (admins.length === 0) {
      await db.execute(
        "INSERT INTO users (id, name, email, password_hash, role, branch) VALUES (?, ?, ?, ?, 'admin', ?)",
        [randomUUID(), "Admin User", adminEmail.toLowerCase(), passwordHash, "Nairobi CBD"],
      );
    } else if (admins[0].role === "admin") {
      await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, admins[0].id]);
    }
  }
}

async function importLegacyJson(db: Pool) {
  const migrationKey = "import-json-store-v1";
  const [migrations] = await db.execute<RowDataPacket[]>(
    "SELECT migration_key FROM app_migrations WHERE migration_key = ?",
    [migrationKey],
  );
  if (migrations.length) return;

  const legacyPath = path.join(process.cwd(), "data", "store.json");
  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const legacy = JSON.parse(raw) as {
    users?: { id: string; name: string; email: string; passwordHash: string; role: Role; branch: string }[];
    branches?: { name: string; city: string }[];
    products?: Product[];
    transactions?: Transaction[];
  };

  for (const branch of legacy.branches ?? []) {
    if (branch.name && branch.city) {
      await db.execute("INSERT IGNORE INTO branches (name, city) VALUES (?, ?)", [branch.name, branch.city]);
    }
  }
  for (const user of legacy.users ?? []) {
    if (
      user.id &&
      user.name &&
      user.email &&
      user.passwordHash &&
      ["admin", "manager", "cashier"].includes(user.role) &&
      user.branch
    ) {
      await db.execute(
        "INSERT IGNORE INTO users (id, name, email, password_hash, role, branch) VALUES (?, ?, ?, ?, ?, ?)",
        [user.id, user.name, user.email.toLowerCase(), user.passwordHash, user.role, user.branch],
      );
    }
  }
  for (const product of legacy.products ?? []) {
    if (Number.isInteger(product.id) && product.name && product.category) {
      await db.execute(
        "INSERT IGNORE INTO products (id, name, category, price, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?)",
        [product.id, product.name, product.category, product.price, product.stock, product.reorderLevel],
      );
    }
  }
  for (const transaction of legacy.transactions ?? []) {
    if (!transaction.id || !transaction.branch || !transaction.items) continue;
    await db.execute(
      `INSERT IGNORE INTO transactions
       (id, branch, customer, payment_method, subtotal, discount, tax, total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.id,
        transaction.branch,
        transaction.customer || "Walk-in customer",
        transaction.paymentMethod || "Cash",
        transaction.subtotal || 0,
        transaction.discount || 0,
        transaction.tax || 0,
        transaction.total || 0,
        new Date(transaction.createdAt || Date.now()),
      ],
    );
    for (const item of transaction.items) {
      if (!Number.isInteger(item.id) || !Number.isInteger(item.qty) || item.qty <= 0) continue;
      await db.execute(
        `INSERT IGNORE INTO transaction_items
         (transaction_id, product_id, product_name, quantity, unit_price)
         VALUES (?, ?, ?, ?, ?)`,
        [transaction.id, item.id, item.name || "Legacy item", item.qty, item.price || 0],
      );
    }
  }
  await db.execute("INSERT INTO app_migrations (migration_key) VALUES (?)", [migrationKey]);
}

async function ready() {
  schemaReady ??= initializeSchema().catch((error: unknown) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  return getPool();
}

function mapProduct(row: ProductRow): Product {
  return {
    id: Number(row.id),
    name: row.name,
    barcode: row.barcode,
    category: row.category,
    price: Number(row.price),
    stock: Number(row.stock),
    reorderLevel: Number(row.reorderLevel),
    stockCounted: Boolean(row.stockCounted),
  };
}

function mapTransaction(row: TransactionRow, items: TransactionItem[] = []): Transaction {
  return {
    id: row.id,
    branch: row.branch,
    registerId: row.registerId,
    shiftId: row.shiftId,
    cashierName: row.cashierName,
    customer: row.customer,
    paymentMethod: row.paymentMethod,
    items,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    total: Number(row.total),
    cashTendered: Number(row.cashTendered),
    changeDue: Number(row.changeDue),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function verifyCredentials(email: string, password: string) {
  const db = await ready();
  const [rows] = await db.execute<UserRow[]>(
    "SELECT id, name, email, password_hash AS passwordHash, role, branch FROM users WHERE email = ? LIMIT 1",
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branch: user.branch,
  };
}

export async function createSession(userId: string) {
  const db = await ready();
  const token = randomUUID();
  await db.execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
  await db.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, userId]);
  return token;
}

export async function deleteSession(token: string) {
  const db = await ready();
  await db.execute("DELETE FROM sessions WHERE token = ?", [token]);
}

export async function getSessionUser(token: string): Promise<User | null> {
  const db = await ready();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.name, u.email, u.password_hash AS passwordHash, u.role, u.branch
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)
     LIMIT 1`,
    [token],
  );
  const user = rows[0];
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branch: user.branch,
  };
}

export async function getProducts(branch: string): Promise<Product[]> {
  const db = await ready();
  const [rows] = await db.query<ProductRow[]>(
    `SELECT p.id, p.name, p.barcode, p.category, p.price,
            COALESCE(i.quantity, 0) AS stock,
            COALESCE(i.reorder_level, 0) AS reorderLevel,
            COALESCE(i.is_counted, FALSE) AS stockCounted
     FROM products p
     LEFT JOIN branch_inventory i ON i.product_id = p.id AND i.branch_name = ?
     ORDER BY p.name`,
    [branch],
  );
  return rows.map(mapProduct);
}

type RegisterListRow = RowDataPacket & {
  id: string;
  branch: string;
  name: string;
  active: number | boolean;
  shiftId: string | null;
  openedBy: string | null;
  openedByName: string | null;
  openingCash: string | number | null;
  openedAt: Date | string | null;
  expectedCash: string | number | null;
  lastClosedCash: string | number | null;
};

function mapRegisterShift(row: RegisterListRow): RegisterShift | null {
  if (!row.shiftId || !row.openedBy || !row.openedByName || row.openingCash === null || !row.openedAt) {
    return null;
  }
  return {
    id: row.shiftId,
    registerId: row.id,
    branch: row.branch,
    registerName: row.name,
    openedBy: row.openedBy,
    openedByName: row.openedByName,
    openingCash: Number(row.openingCash),
    openedAt: new Date(row.openedAt).toISOString(),
    expectedCash: Number(row.expectedCash ?? row.openingCash),
    closedBy: null,
    closedByName: null,
    closingCash: null,
    variance: null,
    closedAt: null,
  };
}

export async function getRegisters(branch: string): Promise<PosRegister[]> {
  const db = await ready();
  const [rows] = await db.execute<RegisterListRow[]>(
    `SELECT r.id, r.branch_name AS branch, r.name, r.is_active AS active,
            s.id AS shiftId, s.opened_by AS openedBy, opener.name AS openedByName,
            s.opening_cash AS openingCash, s.opened_at AS openedAt,
            COALESCE(s.opening_cash + cash.cashSales, s.opening_cash) AS expectedCash,
            previous.closing_cash AS lastClosedCash
     FROM pos_registers r
     LEFT JOIN pos_register_shifts s ON s.register_id = r.id AND s.status = 'open'
     LEFT JOIN users opener ON opener.id = s.opened_by
     LEFT JOIN (
       SELECT shift_id, SUM(total) AS cashSales
       FROM transactions
       WHERE payment_method = 'Cash'
       GROUP BY shift_id
     ) cash ON cash.shift_id = s.id
     LEFT JOIN (
       SELECT shifts.register_id, shifts.closing_cash
       FROM pos_register_shifts shifts
       JOIN (
         SELECT register_id, MAX(closed_at) AS lastClosedAt
         FROM pos_register_shifts
         WHERE status = 'closed'
         GROUP BY register_id
       ) latest ON latest.register_id = shifts.register_id AND latest.lastClosedAt = shifts.closed_at
     ) previous ON previous.register_id = r.id
     WHERE r.branch_name = ?
     ORDER BY r.name`,
    [branch],
  );
  return rows.map((row) => ({
    id: row.id,
    branch: row.branch,
    name: row.name,
    active: Boolean(row.active),
    openShift: mapRegisterShift(row),
    lastClosedCash: row.lastClosedCash === null ? null : Number(row.lastClosedCash),
  }));
}

export async function createRegister(input: { branch: string; name: string }) {
  const db = await ready();
  const id = randomUUID();
  await db.execute(
    "INSERT INTO pos_registers (id, branch_name, name) VALUES (?, ?, ?)",
    [id, input.branch, input.name],
  );
  return { id, branch: input.branch, name: input.name, active: true };
}

export async function recordPosManagerApproval(input: {
  actionKey: string;
  branch: string;
  registerId: string;
  shiftId: string;
  operatorId: string;
  approverId: string;
  action: "cart_item_void" | "basket_discount";
  reason: string;
  details: Record<string, unknown>;
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [registerRows] = await connection.execute<
      (RowDataPacket & { id: string; branch: string; active: number | boolean })[]
    >(
      "SELECT id, branch_name AS branch, is_active AS active FROM pos_registers WHERE id = ? FOR UPDATE",
      [input.registerId],
    );
    const [shiftRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM pos_register_shifts WHERE id = ? AND register_id = ? AND branch_name = ? AND status = 'open' FOR UPDATE",
      [input.shiftId, input.registerId, input.branch],
    );
    const register = registerRows[0];
    if (!register || !register.active || register.branch !== input.branch || !shiftRows.length) {
      const error = new Error("Manager approval requires this branch's open register shift.");
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    const [userRows] = await connection.execute<
      (RowDataPacket & { id: string; branch: string; role: Role; name: string })[]
    >(
      "SELECT id, branch, role, name FROM users WHERE id IN (?, ?) ORDER BY id",
      [input.operatorId, input.approverId],
    );
    const operator = userRows.find((user) => user.id === input.operatorId);
    const approver = userRows.find((user) => user.id === input.approverId);
    if (
      !operator ||
      !approver ||
      operator.id === approver.id ||
      (operator.role !== "admin" && operator.branch !== input.branch) ||
      (approver.role !== "admin" && (approver.role !== "manager" || approver.branch !== input.branch))
    ) {
      const error = new Error("A different manager or administrator from this branch must approve the action.");
      Object.assign(error, { statusCode: 403 });
      throw error;
    }
    const [existingRows] = await connection.execute<
      (RowDataPacket & { id: string; operator_user_id: string; register_id: string; action_type: string })[]
    >(
      "SELECT id, operator_user_id, register_id, action_type FROM pos_manager_approvals WHERE action_key = ?",
      [input.actionKey],
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (
        existing.operator_user_id !== input.operatorId ||
        existing.register_id !== input.registerId ||
        existing.action_type !== input.action
      ) {
        const error = new Error("Approval request key has already been used for another action.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      await connection.commit();
      return { id: existing.id, approverName: approver.name, created: false };
    }
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO pos_manager_approvals
       (id, action_key, branch_name, register_id, shift_id, operator_user_id,
        approver_user_id, action_type, reason, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.actionKey,
        input.branch,
        input.registerId,
        input.shiftId,
        input.operatorId,
        input.approverId,
        input.action,
        input.reason,
        JSON.stringify(input.details),
      ],
    );
    await connection.commit();
    return { id, approverName: approver.name, created: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getPosApprovalHistory(input: {
  registerId: string;
  branch: string;
  operatorId?: string;
  limit?: number;
}): Promise<PosApprovalAudit[]> {
  const db = await ready();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: string;
      action: "cart_item_void" | "basket_discount";
      operatorName: string;
      approverName: string;
      reason: string;
      details: string | Record<string, unknown>;
      usedTransactionId: string | null;
      createdAt: Date | string;
    })[]
  >(
    `SELECT a.id, a.action_type AS action, operator.name AS operatorName,
            approver.name AS approverName, a.reason, a.details,
            a.used_transaction_id AS usedTransactionId, a.created_at AS createdAt
     FROM pos_manager_approvals a
     JOIN users operator ON operator.id = a.operator_user_id
     JOIN users approver ON approver.id = a.approver_user_id
     WHERE a.register_id = ? AND a.branch_name = ?
       ${input.operatorId ? "AND a.operator_user_id = ?" : ""}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    input.operatorId
      ? [input.registerId, input.branch, input.operatorId, input.limit ?? 10]
      : [input.registerId, input.branch, input.limit ?? 10],
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    operatorName: row.operatorName,
    approverName: row.approverName,
    reason: row.reason,
    details: typeof row.details === "string" ? JSON.parse(row.details) as Record<string, unknown> : row.details,
    usedTransactionId: row.usedTransactionId,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function getRegisterShiftHistory(input: {
  registerId: string;
  branch: string;
  limit?: number;
}): Promise<RegisterShiftAuditEvent[]> {
  const db = await ready();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      type: "opened" | "closed";
      actor: string;
      cashCount: string | number;
      expectedCash: string | number | null;
      variance: string | number | null;
      reason: string | null;
      createdAt: Date | string;
    })[]
  >(
    `SELECT e.id, e.event_type AS type, u.name AS actor, e.cash_count AS cashCount,
            e.expected_cash AS expectedCash, e.variance, e.reason, e.created_at AS createdAt
     FROM pos_register_shift_events e
     JOIN pos_register_shifts s ON s.id = e.shift_id
     JOIN users u ON u.id = e.actor_user_id
     WHERE s.register_id = ? AND s.branch_name = ?
     ORDER BY e.id DESC
     LIMIT ?`,
    [input.registerId, input.branch, input.limit ?? 10],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    actor: row.actor,
    cashCount: Number(row.cashCount),
    expectedCash: row.expectedCash === null ? null : Number(row.expectedCash),
    variance: row.variance === null ? null : Number(row.variance),
    reason: row.reason,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function openRegisterShift(input: {
  registerId: string;
  branch: string;
  userId: string;
  canOpenOtherBranch: boolean;
  openingCash: number;
  reason: string | null;
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [registerRows] = await connection.execute<
      (RowDataPacket & { id: string; branch: string; is_active: number | boolean })[]
    >(
      "SELECT id, branch_name AS branch, is_active FROM pos_registers WHERE id = ? FOR UPDATE",
      [input.registerId],
    );
    const register = registerRows[0];
    if (!register || !register.is_active || register.branch !== input.branch) {
      const error = new Error("Register is unavailable for this branch.");
      Object.assign(error, { statusCode: 404 });
      throw error;
    }
    const [userRows] = await connection.execute<(RowDataPacket & { branch: string; role: Role })[]>(
      "SELECT branch, role FROM users WHERE id = ? LIMIT 1",
      [input.userId],
    );
    if (
      !userRows[0] ||
      (userRows[0].branch !== input.branch && !(input.canOpenOtherBranch && userRows[0].role === "admin"))
    ) {
      const error = new Error("Staff can only open a register assigned to their branch.");
      Object.assign(error, { statusCode: 403 });
      throw error;
    }
    const [existingRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM pos_register_shifts WHERE register_id = ? AND status = 'open' LIMIT 1",
      [input.registerId],
    );
    if (existingRows.length) {
      const error = new Error("This register already has an open shift.");
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    const [previousRows] = await connection.execute<
      (RowDataPacket & { id: string; closing_cash: string | number })[]
    >(
      `SELECT id, closing_cash
       FROM pos_register_shifts
       WHERE register_id = ? AND status = 'closed'
       ORDER BY closed_at DESC
       LIMIT 1`,
      [input.registerId],
    );
    const previous = previousRows[0] ?? null;
    const previousCash = previous ? Number(previous.closing_cash) : null;
    const openingVarianceCents = previousCash === null
      ? 0
      : Math.round(input.openingCash * 100) - Math.round(previousCash * 100);
    if (openingVarianceCents !== 0 && !input.reason) {
      const error = new Error("Enter a reason when the opening cash differs from the previous handover count.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }

    const id = randomUUID();
    const openingVariance = openingVarianceCents / 100;
    await connection.execute(
      `INSERT INTO pos_register_shifts
       (id, register_id, branch_name, status, opened_by, opening_cash, opening_variance,
        opening_reason, handover_from_shift_id)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      [
        id,
        input.registerId,
        input.branch,
        input.userId,
        input.openingCash,
        openingVariance,
        input.reason,
        previous?.id ?? null,
      ],
    );
    await connection.execute(
      `INSERT INTO pos_register_shift_events
       (shift_id, event_type, actor_user_id, cash_count, expected_cash, variance, reason, previous_shift_id)
       VALUES (?, 'opened', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.userId,
        input.openingCash,
        previousCash,
        openingVariance,
        input.reason,
        previous?.id ?? null,
      ],
    );
    await connection.commit();
    return { id, openingCash: input.openingCash, openingVariance, openedAt: new Date().toISOString() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeRegisterShift(input: {
  registerId: string;
  branch: string;
  userId: string;
  canCloseOtherCashierShift: boolean;
  closingCash: number;
  reason: string | null;
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [shiftRows] = await connection.execute<
      (RowDataPacket & {
        id: string;
        register_id: string;
        branch_name: string;
        opened_by: string;
        opening_cash: string | number;
        status: "open" | "closed";
      })[]
    >(
      `SELECT id, register_id, branch_name, opened_by, opening_cash, status
       FROM pos_register_shifts
       WHERE register_id = ? AND status = 'open'
       FOR UPDATE`,
      [input.registerId],
    );
    const shift = shiftRows[0];
    if (!shift || shift.branch_name !== input.branch) {
      const error = new Error("No open shift exists for this register.");
      Object.assign(error, { statusCode: 404 });
      throw error;
    }
    if (shift.opened_by !== input.userId && !input.canCloseOtherCashierShift) {
      const error = new Error("Only the cashier who opened this shift or a manager can close it.");
      Object.assign(error, { statusCode: 403 });
      throw error;
    }
    const [salesRows] = await connection.execute<
      (RowDataPacket & { cashSales: string | number })[]
    >(
      "SELECT COALESCE(SUM(total), 0) AS cashSales FROM transactions WHERE shift_id = ? AND payment_method = 'Cash'",
      [shift.id],
    );
    const expectedCents =
      Math.round(Number(shift.opening_cash) * 100) + Math.round(Number(salesRows[0].cashSales) * 100);
    const closingCents = Math.round(input.closingCash * 100);
    const varianceCents = closingCents - expectedCents;
    if (varianceCents !== 0 && !input.reason) {
      const error = new Error("Enter a reason to close the shift with a cash variance.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
    const expectedCash = expectedCents / 100;
    const variance = varianceCents / 100;
    await connection.execute(
      `UPDATE pos_register_shifts
       SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP(3),
           expected_cash = ?, closing_cash = ?, closing_variance = ?, closing_reason = ?
       WHERE id = ? AND status = 'open'`,
      [input.userId, expectedCash, input.closingCash, variance, input.reason, shift.id],
    );
    await connection.execute(
      `INSERT INTO pos_register_shift_events
       (shift_id, event_type, actor_user_id, cash_count, expected_cash, variance, reason)
       VALUES (?, 'closed', ?, ?, ?, ?, ?)`,
      [shift.id, input.userId, input.closingCash, expectedCash, variance, input.reason],
    );
    await connection.commit();
    return {
      id: shift.id,
      expectedCash,
      closingCash: input.closingCash,
      variance,
      closedAt: new Date().toISOString(),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getBranchNames(): Promise<string[]> {
  const db = await ready();
  const [rows] = await db.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM branches WHERE status = 'active' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

export async function saveProduct(product: ProductInput, id?: number) {
  const db = await ready();
  if (id === undefined) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<mysql.ResultSetHeader>(
        "INSERT INTO products (name, barcode, category, price) VALUES (?, ?, ?, ?)",
        [product.name, product.barcode, product.category, product.price],
      );
      await connection.execute(
        `INSERT INTO branch_inventory (branch_name, product_id)
         SELECT name, ? FROM branches WHERE status = 'active'`,
        [result.insertId],
      );
      await connection.commit();
      return { ...product, id: result.insertId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const [result] = await db.execute<mysql.ResultSetHeader>(
    "UPDATE products SET name = ?, barcode = ?, category = ?, price = ? WHERE id = ?",
    [product.name, product.barcode, product.category, product.price, id],
  );
  if (result.affectedRows === 0) return null;
  return { ...product, id };
}

export type StockMovementInput = {
  branch: string;
  productId: number;
  movement: "opening" | "receipt" | "adjustment";
  quantity: number;
  reorderLevel?: number;
  reason: string;
  userId: string;
};

export async function recordStockMovement(input: StockMovementInput) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & { quantity: number; reorderLevel: number; isCounted: number | boolean })[]
    >(
      `SELECT quantity, reorder_level AS reorderLevel, is_counted AS isCounted
       FROM branch_inventory WHERE branch_name = ? AND product_id = ? FOR UPDATE`,
      [input.branch, input.productId],
    );
    const current = rows[0];
    if (!current) {
      const error = new Error("Product inventory was not found for this branch.");
      Object.assign(error, { statusCode: 404 });
      throw error;
    }
    const currentQuantity = Number(current.quantity);
    const isCounted = Boolean(current.isCounted);
    let quantityDelta: number;
    let nextQuantity: number;
    if (input.movement === "opening") {
      if (isCounted) {
        const error = new Error("Opening stock has already been recorded for this product and branch.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      quantityDelta = input.quantity;
      nextQuantity = input.quantity;
    } else {
      if (!isCounted) {
        const error = new Error("Record a verified opening count before receiving or adjusting stock.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      quantityDelta = input.quantity;
      nextQuantity = currentQuantity + quantityDelta;
      if (nextQuantity < 0) {
        const error = new Error("Stock adjustment cannot reduce on-hand stock below zero.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
    }

    await connection.execute(
      `UPDATE branch_inventory
       SET quantity = ?, reorder_level = ?, is_counted = TRUE
       WHERE branch_name = ? AND product_id = ?`,
      [
        nextQuantity,
        input.reorderLevel ?? Number(current.reorderLevel),
        input.branch,
        input.productId,
      ],
    );
    await connection.execute(
      `INSERT INTO stock_movements
       (branch_name, product_id, user_id, movement_type, quantity_delta, quantity_after, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.branch,
        input.productId,
        input.userId,
        input.movement,
        quantityDelta,
        nextQuantity,
        input.reason,
      ],
    );
    await connection.commit();
    return { quantity: nextQuantity, reorderLevel: input.reorderLevel ?? Number(current.reorderLevel) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getStockMovements(branch: string, limit = 100) {
  const db = await ready();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      productId: number;
      productName: string;
      cashierName: string | null;
      movementType: string;
      quantityDelta: number;
      quantityAfter: number;
      reason: string;
      createdAt: Date | string;
    })[]
  >(
    `SELECT m.id, m.product_id AS productId, p.name AS productName,
            u.name AS cashierName, m.movement_type AS movementType,
            m.quantity_delta AS quantityDelta, m.quantity_after AS quantityAfter,
            m.reason, m.created_at AS createdAt
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.branch_name = ?
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ?`,
    [branch, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    productId: Number(row.productId),
    productName: row.productName,
    cashierName: row.cashierName || "System",
    movement: row.movementType,
    quantityDelta: Number(row.quantityDelta),
    quantityAfter: Number(row.quantityAfter),
    reason: row.reason,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function getTransactions(branch?: string, limit = 100): Promise<Transaction[]> {
  const db = await ready();
  const [rows] = branch
    ? await db.execute<TransactionRow[]>(
        `SELECT id, branch, cashier_name AS cashierName, customer, payment_method AS paymentMethod,
                register_id AS registerId, shift_id AS shiftId,
                subtotal, discount, tax, total, cash_tendered AS cashTendered,
                change_due AS changeDue, created_at AS createdAt
         FROM transactions WHERE branch = ? ORDER BY created_at DESC LIMIT ?`,
        [branch, limit],
      )
    : await db.execute<TransactionRow[]>(
        `SELECT id, branch, cashier_name AS cashierName, customer, payment_method AS paymentMethod,
              register_id AS registerId, shift_id AS shiftId,
              subtotal, discount, tax, total, cash_tendered AS cashTendered,
                change_due AS changeDue, created_at AS createdAt
         FROM transactions ORDER BY created_at DESC LIMIT ?`,
        [limit],
      );

  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [itemRows] = await db.execute<
    (RowDataPacket & {
      transactionId: string;
      id: number;
      name: string;
      qty: number;
      price: string | number;
    })[]
  >(
    `SELECT transaction_id AS transactionId, product_id AS id, product_name AS name,
            quantity AS qty, unit_price AS price
     FROM transaction_items WHERE transaction_id IN (${placeholders})`,
    ids,
  );
  return rows.map((row) =>
    mapTransaction(
      row,
      itemRows
        .filter((item) => item.transactionId === row.id)
        .map((item) => ({
          id: Number(item.id),
          name: item.name,
          qty: Number(item.qty),
          price: Number(item.price),
        })),
    ),
  );
}

type MpesaAttemptRow = RowDataPacket & {
  id: string;
  branch: string;
  userId: string;
  phoneNumber: string;
  amount: number;
  status: MpesaPaymentStatus;
  merchantRequestId: string | null;
  checkoutRequestId: string | null;
  resultCode: string | null;
  resultDescription: string | null;
  mpesaReceiptNumber: string | null;
  callbackAmount: string | number | null;
  callbackPhoneNumber: string | null;
  callbackResultCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const mpesaAttemptSelect = `
  SELECT id, branch, user_id AS userId, phone_number AS phoneNumber, amount, status,
         merchant_request_id AS merchantRequestId, checkout_request_id AS checkoutRequestId,
         result_code AS resultCode, result_description AS resultDescription,
         mpesa_receipt_number AS mpesaReceiptNumber, callback_amount AS callbackAmount,
         callback_phone_number AS callbackPhoneNumber,
         callback_result_code AS callbackResultCode,
         created_at AS createdAt, updated_at AS updatedAt
  FROM mpesa_payment_attempts
`;

function mapMpesaAttempt(row: MpesaAttemptRow): MpesaPaymentAttempt {
  return {
    id: row.id,
    branch: row.branch,
    userId: row.userId,
    phoneNumber: row.phoneNumber,
    amount: Number(row.amount),
    status: row.status,
    merchantRequestId: row.merchantRequestId,
    checkoutRequestId: row.checkoutRequestId,
    resultCode: row.resultCode,
    resultDescription: row.resultDescription,
    mpesaReceiptNumber: row.mpesaReceiptNumber,
    callbackAmount: row.callbackAmount === null ? null : Number(row.callbackAmount),
    callbackPhoneNumber: row.callbackPhoneNumber,
    callbackResultCode: row.callbackResultCode,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function createMpesaPaymentAttempt(input: {
  branch: string;
  userId: string;
  idempotencyKey: string;
  phoneNumber: string;
  amount: number;
}) {
  const db = await ready();
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO mpesa_payment_attempts
       (id, branch, user_id, idempotency_key, phone_number, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'initiating')`,
      [id, input.branch, input.userId, input.idempotencyKey, input.phoneNumber, input.amount],
    );
    const attempt = await getMpesaPaymentAttempt(id);
    if (!attempt) throw new Error("New M-Pesa attempt could not be loaded after creation.");
    return { attempt, created: true };
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY")) {
      throw error;
    }
    const [rows] = await db.execute<MpesaAttemptRow[]>(
      `${mpesaAttemptSelect} WHERE user_id = ? AND idempotency_key = ? LIMIT 1`,
      [input.userId, input.idempotencyKey],
    );
    const existing = rows[0];
    if (!existing) throw error;
    if (existing.phoneNumber !== input.phoneNumber || Number(existing.amount) !== input.amount) {
      const conflict = new Error("This idempotency key was already used for a different payment.");
      Object.assign(conflict, { statusCode: 409 });
      throw conflict;
    }
    return { attempt: mapMpesaAttempt(existing), created: false };
  }
}

export async function getMpesaPaymentAttempt(
  id: string,
  userId?: string,
): Promise<MpesaPaymentAttempt | null> {
  const db = await ready();
  const [rows] = await db.execute<MpesaAttemptRow[]>(
    `${mpesaAttemptSelect} WHERE id = ?${userId ? " AND user_id = ?" : ""} LIMIT 1`,
    userId ? [id, userId] : [id],
  );
  return rows[0] ? mapMpesaAttempt(rows[0]) : null;
}

export async function listMpesaPaymentAttempts(
  limit = 100,
  userId?: string,
): Promise<MpesaPaymentAttempt[]> {
  const db = await ready();
  const [rows] = await db.execute<MpesaAttemptRow[]>(
    `${mpesaAttemptSelect}${userId ? " WHERE user_id = ?" : ""} ORDER BY created_at DESC LIMIT ?`,
    userId ? [userId, limit] : [limit],
  );
  return rows.map(mapMpesaAttempt);
}

export async function updateMpesaPaymentSubmission(input: {
  id: string;
  status: "pending" | "failed" | "unknown";
  merchantRequestId?: string | null;
  checkoutRequestId?: string | null;
  resultCode?: string | null;
  resultDescription?: string | null;
}) {
  const db = await ready();
  await db.execute(
    `UPDATE mpesa_payment_attempts
     SET status = ?, merchant_request_id = ?, checkout_request_id = ?,
         result_code = ?, result_description = ?
     WHERE id = ? AND status = 'initiating'`,
    [
      input.status,
      input.merchantRequestId ?? null,
      input.checkoutRequestId ?? null,
      input.resultCode ?? null,
      input.resultDescription?.slice(0, 255) ?? null,
      input.id,
    ],
  );
  let attempt = await getMpesaPaymentAttempt(input.id);
  if (!attempt) throw new Error("M-Pesa payment attempt disappeared during provider submission.");
  if (attempt.merchantRequestId && attempt.checkoutRequestId) {
    const [callbacks] = await db.execute<
      (RowDataPacket & {
        merchantRequestId: string;
        checkoutRequestId: string;
        resultCode: string;
        resultDescription: string;
        amount: string | number | null;
        phoneNumber: string | null;
        receiptNumber: string | null;
      })[]
    >(
      `SELECT merchant_request_id AS merchantRequestId,
              checkout_request_id AS checkoutRequestId,
              result_code AS resultCode, result_description AS resultDescription,
              callback_amount AS amount, callback_phone_number AS phoneNumber,
              mpesa_receipt_number AS receiptNumber
       FROM mpesa_callback_inbox WHERE checkout_request_id = ?
         AND merchant_request_id = ? LIMIT 1`,
      [attempt.checkoutRequestId, attempt.merchantRequestId],
    );
    if (callbacks[0]) {
      const callback = callbacks[0];
      await recordMpesaPaymentCallback({
        merchantRequestId: callback.merchantRequestId,
        checkoutRequestId: callback.checkoutRequestId,
        resultCode: callback.resultCode,
        resultDescription: callback.resultDescription,
        amount: callback.amount === null ? null : Number(callback.amount),
        phoneNumber: callback.phoneNumber,
        receiptNumber: callback.receiptNumber,
      });
      attempt = await getMpesaPaymentAttempt(input.id);
      if (!attempt) throw new Error("M-Pesa attempt disappeared while applying its callback.");
    }
  }
  return attempt;
}

export async function recordMpesaPaymentCallback(input: {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDescription: string;
  amount: number | null;
  phoneNumber: string | null;
  receiptNumber: string | null;
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "DELETE FROM mpesa_callback_inbox WHERE received_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)",
    );
    await connection.execute(
      `INSERT INTO mpesa_callback_inbox
       (checkout_request_id, merchant_request_id, result_code, result_description,
        callback_amount, callback_phone_number, mpesa_receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         merchant_request_id = VALUES(merchant_request_id),
         result_code = VALUES(result_code),
         result_description = VALUES(result_description),
         callback_amount = VALUES(callback_amount),
         callback_phone_number = VALUES(callback_phone_number),
         mpesa_receipt_number = VALUES(mpesa_receipt_number),
         received_at = UTC_TIMESTAMP(3)`,
      [
        input.checkoutRequestId,
        input.merchantRequestId,
        input.resultCode,
        input.resultDescription.slice(0, 255),
        input.amount,
        input.phoneNumber,
        input.receiptNumber?.slice(0, 32) ?? null,
      ],
    );
    const [rows] = await connection.execute<MpesaAttemptRow[]>(
      `${mpesaAttemptSelect}
       WHERE merchant_request_id = ? AND checkout_request_id = ?
       LIMIT 1 FOR UPDATE`,
      [input.merchantRequestId, input.checkoutRequestId],
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return false;
    }
    if (row.status === "confirmed" || row.status === "failed") {
      await connection.execute(
        "DELETE FROM mpesa_callback_inbox WHERE checkout_request_id = ?",
        [input.checkoutRequestId],
      );
      await connection.commit();
      return true;
    }
    const callbackMatches =
      input.amount === Number(row.amount) &&
      input.phoneNumber === row.phoneNumber;
    const isSuccess = input.resultCode === "0";
    const status: MpesaPaymentStatus = !isSuccess
      ? "callback_failed"
      : callbackMatches
        ? "callback_success"
        : "unknown";
    await connection.execute(
      `UPDATE mpesa_payment_attempts
       SET status = ?, callback_amount = ?, callback_phone_number = ?,
           callback_result_code = ?, mpesa_receipt_number = ?,
           result_code = ?, result_description = ?, callback_received_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [
        status,
        input.amount,
        input.phoneNumber,
        input.resultCode,
        input.receiptNumber?.slice(0, 32) ?? null,
        input.resultCode,
        input.resultDescription.slice(0, 255),
        row.id,
      ],
    );
    await connection.execute(
      "DELETE FROM mpesa_callback_inbox WHERE checkout_request_id = ?",
      [input.checkoutRequestId],
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateMpesaPaymentVerification(input: {
  id: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDescription: string;
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<MpesaAttemptRow[]>(
      `${mpesaAttemptSelect} WHERE id = ? LIMIT 1 FOR UPDATE`,
      [input.id],
    );
    const row = rows[0];
    if (!row) {
      const error = new Error("M-Pesa payment attempt was not found.");
      Object.assign(error, { statusCode: 404 });
      throw error;
    }
    if (row.checkoutRequestId !== input.checkoutRequestId) {
      const error = new Error("Provider payment reference did not match this attempt.");
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    if (row.status === "confirmed" || row.status === "failed") {
      await connection.commit();
      return mapMpesaAttempt(row);
    }
    const verifiedSuccess =
      (row.status === "callback_success" || row.status === "unknown") &&
      row.callbackResultCode === "0" &&
      row.callbackAmount !== null &&
      Number(row.callbackAmount) === Number(row.amount) &&
      row.callbackPhoneNumber === row.phoneNumber &&
      input.resultCode === "0";
    const verifiedFailure =
      row.status === "callback_failed" &&
      row.callbackResultCode !== null &&
      row.callbackResultCode !== "0" &&
      input.resultCode === row.callbackResultCode;
    const status: MpesaPaymentStatus = verifiedSuccess
      ? "confirmed"
      : verifiedFailure
        ? "failed"
        : "unknown";
    await connection.execute(
      `UPDATE mpesa_payment_attempts
       SET status = ?, result_code = ?, result_description = ?
       WHERE id = ?`,
      [status, input.resultCode, input.resultDescription.slice(0, 255), input.id],
    );
    const [updatedRows] = await connection.execute<MpesaAttemptRow[]>(
      `${mpesaAttemptSelect} WHERE id = ? LIMIT 1`,
      [input.id],
    );
    await connection.commit();
    return mapMpesaAttempt(updatedRows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createSale(input: {
  branch: string;
  registerId: string;
  cashierId: string;
  cashierName: string;
  customer: string;
  paymentMethod: PaymentMethod;
  cashTendered: number | null;
  discountApprovalId?: string;
  discountPercent?: number;
  items: { id: number; qty: number }[];
}) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [shiftRows] = await connection.execute<
      (RowDataPacket & { id: string })[]
    >(
      `SELECT id
       FROM pos_register_shifts
       WHERE register_id = ? AND branch_name = ? AND status = 'open'
       FOR UPDATE`,
      [input.registerId, input.branch],
    );
    const shift = shiftRows[0];
    if (!shift) {
      const error = new Error("Open a register shift before checkout.");
      Object.assign(error, { statusCode: 409 });
      throw error;
    }
    const quantities = new Map<number, number>();
    for (const item of input.items) {
      quantities.set(item.id, (quantities.get(item.id) ?? 0) + item.qty);
    }
    const productIds = [...quantities.keys()].sort((left, right) => left - right);
    const placeholders = productIds.map(() => "?").join(",");
    const [productRows] = await connection.execute<ProductRow[]>(
      `SELECT p.id, p.name, p.barcode, p.category, p.price,
              i.quantity AS stock, i.reorder_level AS reorderLevel,
              i.is_counted AS stockCounted
       FROM products p
       JOIN branch_inventory i ON i.product_id = p.id AND i.branch_name = ?
       WHERE p.id IN (${placeholders})
       ORDER BY p.id
       FOR UPDATE`,
      [input.branch, ...productIds],
    );
    const products = new Map(productRows.map((product) => [Number(product.id), mapProduct(product)]));
    for (const [id, qty] of quantities) {
      const product = products.get(id);
      if (!product || !Number.isInteger(qty) || qty <= 0 || !product.stockCounted || qty > product.stock) {
        const error = new Error(
          product && !product.stockCounted
            ? `Verified opening stock is required for ${product.name} at ${input.branch}.`
            : product
              ? `Only ${product.stock} ${product.name} left in stock at ${input.branch}.`
              : "One or more items are unavailable at this branch.",
        );
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
    }

    const transactionId = randomUUID();
    const items = productIds.map((id) => {
      const product = products.get(id)!;
      return { id, name: product.name, price: product.price, qty: quantities.get(id)! };
    });
    const subtotalCents = items.reduce(
      (sum, item) => sum + Math.round(item.price * 100) * item.qty,
      0,
    );
    let discountPercent = 0;
    let discountApproval: { id: string; approverId: string; reason: string } | null = null;
    if (input.discountApprovalId || (input.discountPercent ?? 0) !== 0) {
      if (
        !input.discountApprovalId ||
        typeof input.discountPercent !== "number" ||
        !Number.isFinite(input.discountPercent) ||
        input.discountPercent <= 0 ||
        input.discountPercent > 100
      ) {
        const error = new Error("A valid manager-approved basket discount is required.");
        Object.assign(error, { statusCode: 400 });
        throw error;
      }
      const [approvalRows] = await connection.execute<
        (RowDataPacket & {
          id: string;
          approver_user_id: string;
          reason: string;
          details: string | Record<string, unknown>;
          used_transaction_id: string | null;
        })[]
      >(
        `SELECT id, approver_user_id, reason, details, used_transaction_id
         FROM pos_manager_approvals
         WHERE id = ? AND branch_name = ? AND register_id = ? AND shift_id = ?
           AND operator_user_id = ? AND action_type = 'basket_discount'
         FOR UPDATE`,
        [input.discountApprovalId, input.branch, input.registerId, shift.id, input.cashierId],
      );
      const approved = approvalRows[0];
      if (!approved || approved.used_transaction_id) {
        const error = new Error("Manager discount approval is missing, already used, or belongs to another sale.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      let details: Record<string, unknown>;
      try {
        details = typeof approved.details === "string"
          ? JSON.parse(approved.details) as Record<string, unknown>
          : approved.details;
      } catch {
        const error = new Error("Manager discount approval data is invalid.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      const auditedItems = Array.isArray(details.cartItems)
        ? details.cartItems as { id?: unknown; qty?: unknown }[]
        : [];
      const currentItems = items.map((item) => `${item.id}:${item.qty}`).sort();
      const authorizedItems = auditedItems
        .map((item) => `${String(item.id)}:${String(item.qty)}`)
        .sort();
      const authorizedSubtotalCents = Number(details.subtotalCents);
      const authorizedPercent = Number(details.discountPercent);
      if (
        authorizedSubtotalCents !== subtotalCents ||
        authorizedPercent !== input.discountPercent ||
        currentItems.length !== authorizedItems.length ||
        currentItems.some((item, index) => item !== authorizedItems[index])
      ) {
        const error = new Error("Basket changed after manager approval. Request approval again.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      discountPercent = authorizedPercent;
      discountApproval = {
        id: approved.id,
        approverId: approved.approver_user_id,
        reason: approved.reason,
      };
    }
    const discountCents = Math.round(subtotalCents * discountPercent / 100);
    const taxableCents = subtotalCents - discountCents;
    const taxCents = Math.round(taxableCents * 0.16);
    const totalCents = taxableCents + taxCents;
    const subtotal = subtotalCents / 100;
    const discount = discountCents / 100;
    const tax = taxCents / 100;
    const total = totalCents / 100;
    const tenderedCents = input.paymentMethod === "Cash" && input.cashTendered !== null
      ? Math.round(input.cashTendered * 100)
      : 0;
    if (input.paymentMethod === "Cash" && tenderedCents < totalCents) {
      const error = new Error("Cash received must be at least the sale total.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
    const cashTendered = tenderedCents / 100;
    const changeDue = (tenderedCents - totalCents) / 100;

    await connection.execute(
      `INSERT INTO transactions
       (id, branch, register_id, shift_id, cashier_name, customer, payment_method,
        subtotal, discount, discount_approval_id, discount_percent, discount_reason,
        discount_approved_by, tax, total, cash_tendered, change_due)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        input.branch,
        input.registerId,
        shift.id,
        input.cashierName,
        input.customer,
        input.paymentMethod,
        subtotal,
        discount,
        discountApproval?.id ?? null,
        discountPercent,
        discountApproval?.reason ?? null,
        discountApproval?.approverId ?? null,
        tax,
        total,
        cashTendered,
        changeDue,
      ],
    );
    if (discountApproval) {
      const [approvalUpdate] = await connection.execute<mysql.ResultSetHeader>(
        "UPDATE pos_manager_approvals SET used_transaction_id = ? WHERE id = ? AND used_transaction_id IS NULL",
        [transactionId, discountApproval.id],
      );
      if (approvalUpdate.affectedRows !== 1) {
        const error = new Error("Manager discount approval was already consumed.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
    }
    for (const item of items) {
      await connection.execute(
        "INSERT INTO transaction_items (transaction_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
        [transactionId, item.id, item.name, item.qty, item.price],
      );
      const [inventoryUpdate] = await connection.execute<mysql.ResultSetHeader>(
        `UPDATE branch_inventory SET quantity = quantity - ?
         WHERE branch_name = ? AND product_id = ? AND is_counted = TRUE AND quantity >= ?`,
        [item.qty, input.branch, item.id, item.qty],
      );
      if (inventoryUpdate.affectedRows !== 1) {
        const error = new Error("Branch stock changed during checkout. Refresh inventory and try again.");
        Object.assign(error, { statusCode: 409 });
        throw error;
      }
      await connection.execute(
        `INSERT INTO stock_movements
         (branch_name, product_id, user_id, movement_type, quantity_delta, quantity_after, reason, reference_id)
         VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
        [
          input.branch,
          item.id,
          input.cashierId,
          -item.qty,
          products.get(item.id)!.stock - item.qty,
          `Sale ${transactionId}`,
          transactionId,
        ],
      );
    }
    await connection.commit();
    return {
      id: transactionId,
      branch: input.branch,
      registerId: input.registerId,
      shiftId: shift.id,
      cashierName: input.cashierName,
      customer: input.customer,
      paymentMethod: input.paymentMethod,
      items,
      subtotal,
      discount,
      tax,
      total,
      cashTendered,
      changeDue,
      createdAt: new Date().toISOString(),
    } satisfies Transaction;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getStaff() {
  const db = await ready();
  const [rows] = await db.query<(RowDataPacket & User)[]>(
    "SELECT id, name, email, role, branch FROM users ORDER BY name",
  );
  return rows;
}

export async function createStaff(input: {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, "admin">;
  branch: string;
}) {
  const db = await ready();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const id = randomUUID();
  await db.execute(
    "INSERT INTO users (id, name, email, password_hash, role, branch) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.name, input.email.toLowerCase(), passwordHash, input.role, input.branch],
  );
  return { id, name: input.name, email: input.email.toLowerCase(), role: input.role, branch: input.branch };
}

export async function updateStaff(
  id: string,
  input: { role: Role; branch: string; name: string },
) {
  const db = await ready();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    "UPDATE users SET name = ?, role = ?, branch = ? WHERE id = ?",
    [input.name, input.role, input.branch, id],
  );
  return result.affectedRows > 0;
}

export async function getSalesReport(input: {
  from: string;
  to: string;
  branch?: string;
}) {
  const db = await ready();
  const branchFilter = input.branch ? "AND branch = ?" : "";
  const params = input.branch ? [input.from, input.to, input.branch] : [input.from, input.to];
  const [summaryRows] = await db.execute<
    (RowDataPacket & { revenue: string | number; orders: number })[]
  >(
    `SELECT COALESCE(SUM(t.total), 0) AS revenue, COUNT(*) AS orders
     FROM transactions t
     WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 DAY) ${branchFilter}`,
    params,
  );
  const [unitRows] = await db.execute<(RowDataPacket & { units: number })[]>(
    `SELECT COALESCE(SUM(i.quantity), 0) AS units
     FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
     WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 DAY) ${branchFilter.replace("branch", "t.branch")}`,
    params,
  );
  const [daily] = await db.execute<
    (RowDataPacket & { date: string; revenue: string | number; orders: number })[]
  >(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
            SUM(total) AS revenue, COUNT(*) AS orders
     FROM transactions
     WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) ${branchFilter}
     GROUP BY DATE(created_at) ORDER BY DATE(created_at)`,
    params,
  );
  const [topProducts] = await db.execute<
    (RowDataPacket & { name: string; quantity: number; revenue: string | number })[]
  >(
    `SELECT i.product_name AS name, SUM(i.quantity) AS quantity,
            SUM(i.quantity * i.unit_price) AS revenue
     FROM transaction_items i
     JOIN transactions t ON t.id = i.transaction_id
     WHERE t.created_at >= ? AND t.created_at < DATE_ADD(?, INTERVAL 1 DAY) ${branchFilter.replace("branch", "t.branch")}
     GROUP BY i.product_id, i.product_name ORDER BY quantity DESC LIMIT 5`,
    params,
  );

  return {
    summary: {
      revenue: Number(summaryRows[0].revenue),
      orders: Number(summaryRows[0].orders),
      units: Number(unitRows[0].units),
    },
    daily: daily.map((row) => ({
      date: String(row.date),
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    })),
    topProducts: topProducts.map((row) => ({
      name: row.name,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    })),
  };
}
