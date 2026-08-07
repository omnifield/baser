/**
 * ВЫЧИСЛЯЕМОЕ ПРЕДУПРЕЖДЕНИЕ — проба второй громкости.
 *
 * Судится здесь одно свойство и его границы: **обвес говорит человеку, не ломая
 * прогон**. Ни одна беда внутри механизма не имеет права стать отказом — иначе
 * мы завели вторую громкость, которая ведёт себя как первая, и обвес,
 * попытавшийся сказать, ронял бы локацию сильнее молчащего
 * (`tasker:BASER2-232`, шов `tasker:BASER2-226`).
 *
 * Резолверы здесь — заглушки теста, а не файлы: грузит модули ДВЕРЬ, этот вход
 * ничего не читает и не исполняет. Живой резолвер обвеса-фикстуры прогоняется в
 * `probe.spec.ts` — там он и загружается настоящим `import`.
 */

import { describe, expect, it } from 'vitest';
import {
  parseSourceDeclaration,
  type SourceDeclaration,
} from './declaration.js';
import { codesOf, declarationBlock } from './form.fixture.js';
import {
  resolveWarning,
  type ComputeWarning,
  type SourceWarning,
} from './warning.js';
import { WARNING_SINCE } from './version.js';

/** Объявление, у которого предупреждение объявлено пригодной ссылкой. */
function говорящий(patch: Record<string, unknown> = {}): SourceDeclaration {
  const result = parseSourceDeclaration(
    declarationBlock({ warningFrom: './warnings.mjs#hooksPath', ...patch }),
  );
  if (!result.ok) {
    throw new Error(
      `объявление не разобралось: ${JSON.stringify(result.problems)}`,
    );
  }
  return result.value;
}

/** Отказы разбора; бросает, если объявление внезапно оказалось пригодным. */
function refusals(patch: Record<string, unknown>) {
  const result = parseSourceDeclaration(declarationBlock(patch));
  if (result.ok) {
    throw new Error('ожидался отказ, объявление разобралось');
  }
  return result.problems;
}

/** Порт двери-заглушки: что бы резолвер ни сделал, делает это здесь. */
function порт(behaviour: () => unknown): ComputeWarning {
  return () => behaviour();
}

describe('объявление: ссылка на резолвер предупреждения', () => {
  it('РАЗБИРАЕТСЯ ТЕМ ЖЕ, ЧЕМ ВЫЧИСЛЯЕМЫЙ ДЕФОЛТ — второго механизма нет', () => {
    expect(говорящий().warningFrom).toEqual({
      module: 'warnings.mjs',
      member: 'hooksPath',
    });
  });

  it('ОБВЕС БЕЗ ПОЛЯ РАЗБИРАЕТСЯ РОВНО КАК РАНЬШЕ', () => {
    // Неизменность, а не «тоже работает»: форма 7 прибавила поле и не тронула
    // ничего из объявленного выпущенными обвесами. Поля нет — его нет и в
    // разобранном объявлении, а не `undefined` рядом с остальными.
    const result = parseSourceDeclaration(declarationBlock());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.warningFrom).toBeUndefined();
    expect('warningFrom' in result.value).toBe(false);
  });

  it('НЕПРИГОДНАЯ ССЫЛКА — ОТКАЗ РАЗБОРА, до применения', () => {
    // Здесь непригоден сам ОБВЕС, а не обстановка: автор объявил поведение,
    // которого не будет. Промолчать значило бы оставить его в уверенности, что
    // предупреждение работает.
    expect(codesOf(refusals({ warningFrom: 'warnings.mjs' }))).toEqual([
      'invalid-resolver-ref @ baser.warningFrom',
    ]);
    expect(codesOf(refusals({ warningFrom: 42 }))).toEqual([
      'wrong-type @ baser.warningFrom',
    ]);
    // Резолвер обязан лежать в пакете обвеса — правила пути общие с `defaultFrom`.
    expect(
      codesOf(refusals({ warningFrom: '../чужое.mjs#hooksPath' })),
    ).toEqual(['invalid-resolver-ref @ baser.warningFrom']);
  });

  it('ПРЕДУПРЕЖДЕНИЕ В ОБЪЯВЛЕНИИ ФОРМЫ 6: сказано, что поднять', () => {
    // Старый baser назвал бы поле опечаткой, автор убрал бы его — и обвес
    // вернулся бы к одной громкости: промолчать либо уронить весь прогон.
    const problems = refusals({
      formVersion: WARNING_SINCE - 1,
      warningFrom: './warnings.mjs#hooksPath',
    });
    expect(codesOf(problems)).toEqual([
      'form-version-unsupported @ baser.warningFrom',
    ]);
    expect(problems[0].message).toContain(
      `подними "formVersion" до ${WARNING_SINCE}`,
    );
  });
});

describe('обвес говорит человеку', () => {
  it('вернул текст — он доезжает ДОСЛОВНО', () => {
    const сказал = resolveWarning(
      говорящий(),
      порт(() => 'у локации задан core.hooksPath — хук ляжет и не сработает'),
    );

    expect(сказал).toEqual({
      kind: 'said',
      text: 'у локации задан core.hooksPath — хук ляжет и не сработает',
    });
  });

  it('ОБВЕС БЕЗ ПРЕДУПРЕЖДЕНИЯ — «сказать нечего», а не беда', () => {
    const молчит = parseSourceDeclaration(declarationBlock());
    expect(молчит.ok).toBe(true);
    if (!молчит.ok) return;

    // Порт не зовётся вовсе: звать нечего, и выдумывать повод незачем.
    expect(
      resolveWarning(
        молчит.value,
        порт(() => {
          throw new Error('порт не должен был понадобиться');
        }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('РЕЗОЛВЕР ВЕРНУЛ ПУСТОТУ — предупреждения нет, прогон обычный', () => {
    // Самый частый ответ: условие не сложилось, говорить не о чем. Выражается
    // он значением обвеса, а не условием у двери.
    for (const пустота of [null, undefined]) {
      expect(
        resolveWarning(
          говорящий(),
          порт(() => пустота),
        ),
      ).toEqual({
        kind: 'none',
      });
    }
  });
});

describe('вторая громкость НЕ ведёт себя как первая', () => {
  it('РЕЗОЛВЕР БРОСИЛ — ПРОГОН НЕ ПАДАЕТ, и это названо данными', () => {
    // Главное обещание формы 7. Снятая защита от броска роняет эту пробу
    // броском наружу, а не красным сравнением, — и это ровно то, чего мы не
    // хотим в чужой локации.
    const упал = порт(() => {
      throw new Error('git config не прочитался');
    });
    expect(() => resolveWarning(говорящий(), упал)).not.toThrow();

    const результат: SourceWarning = resolveWarning(говорящий(), упал);
    expect(результат.kind).toBe('failed');
    if (результат.kind !== 'failed') return;
    expect(результат.problem.code).toBe('resolver-failed');
    expect(результат.problem.at).toBe('omnifield/devbox.warningFrom');
    // Чужой бросок пересказан человеком, а не проглочен.
    expect(результат.problem.message).toContain('git config не прочитался');
    // И сказано главное: это не отказ.
    expect(результат.problem.message).toContain('предупреждение не отказ');
  });

  it('бросок НЕ Error — пересказывается тем же порядком', () => {
    // Резолвер пишет посторонний, и бросают в JS чем угодно.
    const строкой = resolveWarning(
      говорящий(),
      порт(() => {
        throw 'просто строка';
      }),
    );
    expect(строкой.kind).toBe('failed');
    if (строкой.kind !== 'failed') return;
    expect(строкой.problem.message).toContain('просто строка');
  });

  it('ВЕРНУЛ НЕ СТРОКУ — отказ ДАННЫМИ с кодом, а не отказ прогона', () => {
    // Снятая проверка типа роняет эту пробу: число уехало бы в жанр «остаётся
    // человеку», где печатают строки, которые читают глазами.
    for (const небрежность of [42, true, { text: 'объектом' }, ['списком']]) {
      const результат = resolveWarning(
        говорящий(),
        порт(() => небрежность),
      );
      expect(результат).toMatchObject({
        kind: 'failed',
        problem: { code: 'wrong-type' },
      });
    }
  });

  it('ВЕРНУЛ ПУСТУЮ СТРОКУ — сказанное ничем, и это названо', () => {
    // «Сказать нечего» выражается null. Пустая строка от исправной работы
    // неотличима — то самое молчание, против которого поле заведено.
    for (const пусто of ['', '   ', '\n\t']) {
      expect(
        resolveWarning(
          говорящий(),
          порт(() => пусто),
        ),
      ).toMatchObject({
        kind: 'failed',
        problem: { code: 'empty-string' },
      });
    }
  });

  it('вернул обещание — резолвер обязан быть синхронным', () => {
    const обещанием = resolveWarning(
      говорящий(),
      порт(() => Promise.resolve('поздно')),
    );
    expect(обещанием).toMatchObject({
      kind: 'failed',
      problem: { code: 'resolver-async' },
    });

    // Ловится по `then`, а не по `instanceof Promise`: обещание чужого рантайма
    // — то же нарушение, и пропустить его значило бы поймать только свой случай.
    expect(
      resolveWarning(
        говорящий(),
        порт(() => ({ then: () => undefined })),
      ),
    ).toMatchObject({ kind: 'failed', problem: { code: 'resolver-async' } });
  });

  it('ПОРТА НЕТ — это тоже данные, а не тихое «сказать нечего»', () => {
    // Разница между «обвес молчит» и «мы не умеем его спросить» видна только
    // здесь: сложив их, мы потеряли бы дефект двери целиком.
    expect(resolveWarning(говорящий())).toMatchObject({
      kind: 'failed',
      problem: { code: 'resolver-failed' },
    });
  });

  it('НИ ОДНА БЕДА НЕ ОСТАНАВЛИВАЕТ ПРОГОН — перебором, а не по одной', () => {
    // Утверждение целиком: что бы ни случилось внутри механизма, наружу
    // приезжает состояние, а не `FormResult` с `ok: false`, и не бросок.
    const беды: (() => unknown)[] = [
      () => {
        throw new Error('бросил');
      },
      () => Promise.resolve('обещал'),
      () => 42,
      () => '',
    ];

    for (const беда of беды) {
      const результат = resolveWarning(говорящий(), порт(беда));
      expect(результат.kind).toBe('failed');
      // `ok` у состояния нет вовсе: перепутать его с отказом разбора нечем.
      expect('ok' in результат).toBe(false);
    }
  });

  it('АДРЕС ОТКАЗА — ЛИЧНОСТЬ ОБВЕСА, а не какой-то один артефакт', () => {
    // Предупреждение принадлежит применению ОБВЕСА: артефактов у него может
    // быть пять, и назвать один из них значило бы соврать адресом.
    const свой = говорящий({
      source: {
        id: 'omnifield/git',
        title: 'Git-обвязка',
        contentRoot: 'template',
      },
    });

    const результат = resolveWarning(
      свой,
      порт(() => {
        throw new Error('упал');
      }),
    );
    expect(результат).toMatchObject({
      problem: { at: 'omnifield/git.warningFrom' },
    });
  });
});
