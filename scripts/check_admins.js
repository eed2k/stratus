const pg = require('../server/db-postgres');
(async () => {
  await pg.initPostgres();
  const users = await pg.getAllUsers();
  users.forEach(u => console.log(u.role, u.email));
  process.exit(0);
})();
