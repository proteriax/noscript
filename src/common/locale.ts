export {}

const _ = browser.i18n.getMessage
const i18n = (() => {
  const i18n = {
    // derived from  http://github.com/piroor/webextensions-lib-l10n

    updateString(aString) {
      return aString.replace(/__MSG_(.+?)__/g, aMatched => {
        const key = aMatched.slice(6, -2)
        return _(key)
      })
    },

    updateDOM(rootNode = document) {
      const texts = document.evaluate(
        'descendant::text()[contains(self::text(), "__MSG_")]',
        rootNode,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      )
      for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++) {
        const text = texts.snapshotItem(i)
        text.nodeValue = this.updateString(text.nodeValue)
      }

      const attributes = document.evaluate(
        'descendant::*/attribute::*[contains(., "__MSG_")]',
        rootNode,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      )
      for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++) {
        const attribute = attributes.snapshotItem(i)
        debug("apply", attribute)
        attribute.value = this.updateString(attribute.value)
      }
    },
  }

  document.addEventListener("DOMContentLoaded", e => i18n.updateDOM())
  return i18n
})()
