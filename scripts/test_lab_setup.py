import unittest
from unittest.mock import MagicMock

import pg_setup
from lab_setup import SQL, Snowflake, render, split_statements
from contract_pipeline import Pipeline, names_from


class SplitStatementsTests(unittest.TestCase):
    def test_semicolons_inside_quotes_comments_and_dollar_blocks(self):
        script = ("SELECT 'a;b' AS x; -- note; here\n"
                  "/* block; comment */ SELECT 1;\n"
                  "EXECUTE IMMEDIATE $$\nBEGIN\n  RETURN 'x;y';\nEND;\n$$;\n"
                  "SELECT 'it''s; fine'")
        self.assertEqual(split_statements(script), [
            "SELECT 'a;b' AS x",
            'SELECT 1',
            "EXECUTE IMMEDIATE $$\nBEGIN\n  RETURN 'x;y';\nEND;\n$$",
            "SELECT 'it''s; fine'",
        ])

    def test_seed_file_keeps_scripting_block_whole(self):
        statements = split_statements((SQL / '01_seed.sql').read_text())
        blocks = [s for s in statements if s.startswith('EXECUTE IMMEDIATE')]
        self.assertEqual(len(blocks), 1)
        self.assertTrue(blocks[0].endswith('$$'))


class RenderTests(unittest.TestCase):
    names = names_from(SQL / 'names.default.env')

    def test_every_setup_file_renders(self):
        values = {**self.names, 'pg_instance': 'SEAT_SWEEPER_PG', 'mirror_db': 'SEAT_SWEEPER_OPS_202610231428',
                  'pg_host': 'abc.example-account.us-west-2.aws.postgres.snowflake.app'}
        for name in ('00_setup.sql', '01_seed.sql', '05_ops_views.sql', '06_app_postgres_access.sql'):
            self.assertNotRegex(render((SQL / name).read_text(), values), r'<%\s*\w+\s*%>', name)

    def test_missing_value_fails(self):
        with self.assertRaises(ValueError):
            render('SELECT <% mirror_db %>', self.names)

    def test_rejects_injection_in_values(self):
        with self.assertRaises(ValueError):
            render('SELECT 1', {'lab_db': "X; DROP DATABASE Y"})
        with self.assertRaises(ValueError):
            render('SELECT 1', {'pg_host': "h'); DROP TABLE t; --"})


class SessionAdapterTests(unittest.TestCase):
    def test_pipeline_uses_session_for_sql_put_and_get(self):
        sf = MagicMock()
        sf.rows.return_value = [{'ok': 1}]
        pipeline = Pipeline(None, names_from(SQL / 'names.default.env'), sf=sf)
        self.assertEqual(pipeline.sql('SELECT 1'), [{'ok': 1}])
        pipeline.put('/tmp/a.pdf', '@S/baseline/')
        pipeline.get('@S/baseline/a.pdf', '/tmp/x')
        sf.put.assert_called_once_with('/tmp/a.pdf', '@S/baseline/')
        sf.get.assert_called_once_with('@S/baseline/a.pdf', '/tmp/x')

    def test_snowpark_rows_are_dicts(self):
        row = MagicMock()
        row.as_dict.return_value = {'name': 'X'}
        session = MagicMock()
        session.sql.return_value.collect.return_value = [row]
        self.assertEqual(Snowflake(session=session).rows('SHOW X'), [{'name': 'X'}])
        self.assertTrue(Snowflake(session=session).in_snowsight)


class PostgresTests(unittest.TestCase):
    def test_admin_password_from_create_response_shapes(self):
        self.assertEqual(pg_setup.admin_password_from({'access_roles': '{"snowflake_admin": "p1", "application": "p2"}'}), 'p1')
        self.assertEqual(pg_setup.admin_password_from({'access_roles': [{'name': 'snowflake_admin', 'password': 'p3'}]}), 'p3')
        self.assertIsNone(pg_setup.admin_password_from({'access_roles': '{}'}))

    def test_instance_repr_hides_password(self):
        self.assertNotIn('secret-pw', repr(pg_setup.Instance('PG', 'h', 'ca', 'secret-pw')))

    def test_existing_setup_does_not_rotate_password(self):
        sf = MagicMock()
        sf.rows.return_value = [{'name': 'PG_APP_LOGIN'}]
        pg_setup.ensure_app_database(sf, pg_setup.Instance('PG', 'h.example', 'CA'), names_from(SQL / 'names.default.env'))
        sent = ' '.join(c.args[0] for c in sf.rows.call_args_list)
        self.assertNotIn('RESET ACCESS', sent)
        self.assertNotIn('PG_APP_LOGIN TYPE = PASSWORD', sent)


if __name__ == '__main__':
    unittest.main()
