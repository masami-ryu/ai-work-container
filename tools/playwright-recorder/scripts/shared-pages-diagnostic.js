async page => {
  const pages = page.context().pages();

  return await Promise.all(pages.map(async (targetPage, index) => {
    const inputs = targetPage.locator('input, textarea, select');
    const inputCount = await inputs.count().catch(() => 0);
    const inputLimit = Math.min(inputCount, 30);
    const inputFields = [];

    for (let inputIndex = 0; inputIndex < inputLimit; inputIndex += 1) {
      const input = inputs.nth(inputIndex);
      inputFields.push({
        index: inputIndex,
        tag: await input.evaluate(element => element.tagName.toLowerCase()).catch(() => null),
        type: await input.getAttribute('type').catch(() => null),
        id: await input.getAttribute('id').catch(() => null),
        name: await input.getAttribute('name').catch(() => null),
        placeholder: await input.getAttribute('placeholder').catch(() => null),
        autocomplete: await input.getAttribute('autocomplete').catch(() => null),
        visible: await input.isVisible().catch(() => null),
      });
    }

    return {
      index,
      cliCurrent: targetPage === page,
      url: targetPage.url(),
      title: await targetPage.title().catch(() => ''),
      viewport: targetPage.viewportSize(),
      frameCount: targetPage.frames().length,
      inputCount,
      inputFields,
    };
  }));
}
