#!/usr/bin/env node
/**
 * Исполняемая команда магазина.
 *
 * Файл намеренно пустой по смыслу: он переводит процесс в вызов и обратно, и
 * ничего не решает. Всё, что можно проверить пробой, живёт в `cli()` — иначе
 * приёмка упиралась бы в запуск процесса, а поведение команды проверялось бы
 * глазами.
 */

import { cli } from '../lib/cli.js';

const outcome = await cli(process.argv.slice(2), process.cwd());

process.stdout.write(outcome.stdout);
process.exitCode = outcome.exitCode;
